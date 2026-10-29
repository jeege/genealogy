package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

// photoColumns 只取业务字段；URL 由 API 层拼接，不落库。
const photoColumns = `
	id, member_id, original_path, thumbnail_path,
	width, height, byte_size, caption, sort_order, created_at`

// ListMemberPhotos 按用户排序返回某成员的全部照片。
func (s *Store) ListMemberPhotos(ctx context.Context, memberID int64) ([]domain.MemberPhoto, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT`+photoColumns+`
		FROM public.member_photos
		WHERE member_id = $1
		ORDER BY sort_order ASC, id ASC`, memberID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	photos := make([]domain.MemberPhoto, 0, 4)
	for rows.Next() {
		photo, err := scanPhoto(rows)
		if err != nil {
			return nil, err
		}
		photos = append(photos, photo)
	}
	return photos, rows.Err()
}

func scanPhoto(row pgx.Row) (domain.MemberPhoto, error) {
	var photo domain.MemberPhoto
	var originalPath, thumbnailPath string
	err := row.Scan(
		&photo.ID, &photo.MemberID, &originalPath, &thumbnailPath,
		&photo.Width, &photo.Height, &photo.ByteSize, &photo.Caption,
		&photo.SortOrder, &photo.CreatedAt,
	)
	if err != nil {
		return domain.MemberPhoto{}, normalizeNotFound(err)
	}
	// 路径不直接暴露给前端，交由 API 层转成 URL 后再赋值到 URL/ThumbURL。
	photo.URL = originalPath
	photo.ThumbURL = thumbnailPath
	return photo, nil
}

// AddMemberPhoto 追加一张照片，排序号取当前最大值 + 1。
func (s *Store) AddMemberPhoto(ctx context.Context, input domain.MemberPhotoInput) (domain.MemberPhoto, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO public.member_photos
			(member_id, original_path, thumbnail_path, width, height, byte_size, caption, sort_order)
		VALUES ($1, $2, $3, $4, $5, $6, $7,
			COALESCE((SELECT max(sort_order) + 1 FROM public.member_photos WHERE member_id = $1), 0))
		RETURNING`+photoColumns,
		input.MemberID, input.OriginalPath, input.ThumbnailPath,
		input.Width, input.Height, input.ByteSize, input.Caption,
	)
	return scanPhoto(row)
}

// GetMemberPhoto 返回单张照片，用于删除前取路径。
func (s *Store) GetMemberPhoto(ctx context.Context, id int64) (domain.MemberPhoto, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT`+photoColumns+` FROM public.member_photos WHERE id = $1`, id)
	return scanPhoto(row)
}

// DeleteMemberPhoto 删除一条照片记录，返回其磁盘路径供调用方清理文件。
func (s *Store) DeleteMemberPhoto(ctx context.Context, id int64) (originalPath string, thumbnailPath string, err error) {
	row := s.pool.QueryRow(ctx, `
		DELETE FROM public.member_photos WHERE id = $1
		RETURNING original_path, thumbnail_path`, id)
	err = row.Scan(&originalPath, &thumbnailPath)
	if err != nil {
		return "", "", normalizeNotFound(err)
	}
	return originalPath, thumbnailPath, nil
}

// ListPhotosForMembers 批量取多张照片的路径，用于删除成员时清理文件。
func (s *Store) ListPhotosForMembers(ctx context.Context, memberIDs []int64) ([]string, error) {
	if len(memberIDs) == 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT original_path, thumbnail_path
		FROM public.member_photos
		WHERE member_id = ANY($1)`, memberIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var paths []string
	for rows.Next() {
		var original, thumbnail string
		if err := rows.Scan(&original, &thumbnail); err != nil {
			return nil, err
		}
		paths = append(paths, original, thumbnail)
	}
	return paths, rows.Err()
}

// UpdatePhotoCaption 修改照片说明文字。
func (s *Store) UpdatePhotoCaption(ctx context.Context, id int64, caption *string) (domain.MemberPhoto, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE public.member_photos SET caption = $2 WHERE id = $1
		RETURNING`+photoColumns, id, caption)
	photo, err := scanPhoto(row)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return domain.MemberPhoto{}, domain.ErrNotFound
		}
		return domain.MemberPhoto{}, err
	}
	return photo, nil
}
