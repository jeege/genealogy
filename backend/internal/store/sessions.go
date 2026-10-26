package store

import (
	"context"
	"time"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

func (s *Store) CreateSession(ctx context.Context, userID int64, tokenHash string, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO public.sessions (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)`, userID, tokenHash, expiresAt)
	return err
}

func (s *Store) FindUserBySession(ctx context.Context, tokenHash string, now time.Time) (domain.User, error) {
	var user domain.User
	err := s.pool.QueryRow(ctx, `
		SELECT u.id, u.email, u.password_hash, u.created_at, u.updated_at
		FROM public.sessions s
		JOIN public.users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.expires_at > $2`, tokenHash, now,
	).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return domain.User{}, normalizeNotFound(err)
	}
	return user, nil
}

func (s *Store) DeleteSession(ctx context.Context, tokenHash string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM public.sessions WHERE token_hash = $1`, tokenHash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (s *Store) DeleteUserSessions(ctx context.Context, userID int64) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM public.sessions WHERE user_id = $1`, userID)
	return err
}

func (s *Store) DeleteExpiredSessions(ctx context.Context, now time.Time) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM public.sessions WHERE expires_at <= $1`, now)
	return err
}
