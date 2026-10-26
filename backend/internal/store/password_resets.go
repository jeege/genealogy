package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

func (s *Store) CreatePasswordReset(ctx context.Context, userID int64, tokenHash string, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO public.password_reset_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)`, userID, tokenHash, expiresAt)
	return err
}

// ConsumePasswordReset 以原子更新标记令牌已使用，防止并发重复重置。
func (s *Store) ConsumePasswordReset(ctx context.Context, tokenHash string, now time.Time) (int64, error) {
	var userID int64
	err := s.pool.QueryRow(ctx, `
		UPDATE public.password_reset_tokens
		SET used_at = now()
		WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
		RETURNING user_id`, tokenHash, now,
	).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, domain.ErrInvalidResetToken
		}
		return 0, err
	}
	return userID, nil
}
