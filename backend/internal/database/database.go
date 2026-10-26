// Package database 管理 PostgreSQL 连接池与内嵌迁移。
package database

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Database 封装 pgx 连接池。
type Database struct {
	Pool *pgxpool.Pool
}

// Open 创建连接池并验证数据库可达。连接串完全由 DATABASE_URL 决定。
func Open(ctx context.Context, databaseURL string) (*Database, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("解析 DATABASE_URL 失败：%w", err)
	}
	if config.MaxConns < 10 {
		config.MaxConns = 10
	}
	config.MinConns = 1
	config.MaxConnLifetime = time.Hour
	config.MaxConnIdleTime = 30 * time.Minute
	config.HealthCheckPeriod = time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("创建数据库连接池失败：%w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("连接数据库失败：%w", err)
	}
	return &Database{Pool: pool}, nil
}

func (db *Database) Close() {
	if db != nil && db.Pool != nil {
		db.Pool.Close()
	}
}

func (db *Database) Ping(ctx context.Context) error {
	return db.Pool.Ping(ctx)
}

// Migrate 按文件名顺序执行尚未应用的 SQL 迁移。
func (db *Database) Migrate(ctx context.Context) error {
	if _, err := db.Pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS public.schema_migrations (
		version text PRIMARY KEY,
		applied_at timestamptz NOT NULL DEFAULT now()
	)`); err != nil {
		return fmt.Errorf("创建迁移记录表失败：%w", err)
	}

	files, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(files)
	for _, file := range files {
		version := strings.TrimSuffix(path.Base(file), ".sql")
		var applied bool
		if err := db.Pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version = $1)`, version,
		).Scan(&applied); err != nil {
			return fmt.Errorf("读取迁移状态失败：%w", err)
		}
		if applied {
			continue
		}
		body, err := migrations.ReadFile(file)
		if err != nil {
			return err
		}
		tx, err := db.Pool.Begin(ctx)
		if err != nil {
			return err
		}
		// pgx 扩展协议不允许一次执行多条语句；在同一事务中使用简单协议执行脚本。
		if _, err := tx.Conn().PgConn().Exec(ctx, string(body)).ReadAll(); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("执行迁移 %s 失败：%w", version, err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO public.schema_migrations(version) VALUES ($1)`, version,
		); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("记录迁移 %s 失败：%w", version, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("提交迁移 %s 失败：%w", version, err)
		}
	}
	return nil
}
