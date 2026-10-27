package store

import (
	"context"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

func (s *Store) CountUsers(ctx context.Context) (int64, error) {
	var count int64
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM public.users`).Scan(&count)
	return count, err
}

func (s *Store) CreateUser(ctx context.Context, username, passwordHash string) (domain.User, error) {
	var user domain.User
	err := s.pool.QueryRow(ctx, `
		INSERT INTO public.users (username, password_hash)
		VALUES ($1, $2)
		RETURNING id, username, password_hash, created_at, updated_at`,
		username, passwordHash,
	).Scan(&user.ID, &user.Username, &user.PasswordHash, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		if pgErrorCode(err) == "23505" {
			return domain.User{}, domain.ErrUsernameTaken
		}
		return domain.User{}, err
	}
	return user, nil
}

func (s *Store) FindUserByUsername(ctx context.Context, username string) (domain.User, error) {
	var user domain.User
	err := s.pool.QueryRow(ctx, `
		SELECT id, username, password_hash, created_at, updated_at
		FROM public.users
		WHERE lower(username) = lower($1)`, username,
	).Scan(&user.ID, &user.Username, &user.PasswordHash, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return domain.User{}, normalizeNotFound(err)
	}
	return user, nil
}

func (s *Store) FindUserByID(ctx context.Context, id int64) (domain.User, error) {
	var user domain.User
	err := s.pool.QueryRow(ctx, `
		SELECT id, username, password_hash, created_at, updated_at
		FROM public.users
		WHERE id = $1`, id,
	).Scan(&user.ID, &user.Username, &user.PasswordHash, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return domain.User{}, normalizeNotFound(err)
	}
	return user, nil
}

func (s *Store) UpdatePassword(ctx context.Context, userID int64, passwordHash string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE public.users
		SET password_hash = $2, updated_at = now()
		WHERE id = $1`, userID, passwordHash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
