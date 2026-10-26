package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

const memberColumns = `
	m.id, m.name, m.generation, m.sibling_order, m.father_id, f.name AS father_name,
	m.gender, m.official_position, COALESCE(m.is_alive, true) AS is_alive, m.spouse, m.remarks,
	m.birthday::text, m.death_date::text, m.birth_date_raw, m.death_date_raw,
	m.residence_place, m.updated_at`

const memberFrom = `
	FROM public.family_members m
	LEFT JOIN public.family_members f ON f.id = m.father_id`

func scanMember(row pgx.Row) (domain.Member, error) {
	var member domain.Member
	err := row.Scan(
		&member.ID, &member.Name, &member.Generation, &member.SiblingOrder,
		&member.FatherID, &member.FatherName, &member.Gender, &member.OfficialPosition,
		&member.IsAlive, &member.Spouse, &member.Remarks, &member.Birthday,
		&member.DeathDate, &member.BirthDateRaw, &member.DeathDateRaw,
		&member.ResidencePlace, &member.UpdatedAt,
	)
	if err != nil {
		return domain.Member{}, normalizeNotFound(err)
	}
	return member, nil
}

func (s *Store) ListMembers(ctx context.Context, page, pageSize int, search string) ([]domain.Member, int, error) {
	var total int
	if err := s.pool.QueryRow(ctx, `
		SELECT count(*) FROM public.family_members m
		WHERE ($1 = '' OR m.name ILIKE '%' || $1 || '%')`, search,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * pageSize
	rows, err := s.pool.Query(ctx, `SELECT`+memberColumns+memberFrom+`
		WHERE ($1 = '' OR m.name ILIKE '%' || $1 || '%')
		ORDER BY m.generation ASC NULLS LAST, m.sibling_order ASC NULLS LAST, m.id ASC
		LIMIT $2 OFFSET $3`, search, pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	members := make([]domain.Member, 0, pageSize)
	for rows.Next() {
		member, err := scanMember(rows)
		if err != nil {
			return nil, 0, err
		}
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return members, total, nil
}

func (s *Store) ListAllMembers(ctx context.Context) ([]domain.Member, error) {
	rows, err := s.pool.Query(ctx, `SELECT`+memberColumns+memberFrom+`
		ORDER BY m.generation ASC NULLS LAST, m.sibling_order ASC NULLS LAST, m.id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := make([]domain.Member, 0)
	for rows.Next() {
		member, err := scanMember(rows)
		if err != nil {
			return nil, err
		}
		members = append(members, member)
	}
	return members, rows.Err()
}

func (s *Store) ListMemberOptions(ctx context.Context) ([]domain.MemberOption, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, generation
		FROM public.family_members
		ORDER BY generation ASC NULLS LAST, name ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	options := make([]domain.MemberOption, 0)
	for rows.Next() {
		var option domain.MemberOption
		if err := rows.Scan(&option.ID, &option.Name, &option.Generation); err != nil {
			return nil, err
		}
		options = append(options, option)
	}
	return options, rows.Err()
}

func (s *Store) ListMembersForTimeline(ctx context.Context) ([]domain.TimelineMember, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, birthday::text, death_date::text, generation
		FROM public.family_members
		ORDER BY birthday ASC NULLS LAST, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := make([]domain.TimelineMember, 0)
	for rows.Next() {
		var member domain.TimelineMember
		if err := rows.Scan(&member.ID, &member.Name, &member.Birthday, &member.DeathDate, &member.Generation); err != nil {
			return nil, err
		}
		members = append(members, member)
	}
	return members, rows.Err()
}

func (s *Store) ListBiographyMembers(ctx context.Context) ([]domain.Member, error) {
	rows, err := s.pool.Query(ctx, `SELECT`+memberColumns+memberFrom+`
		WHERE m.remarks IS NOT NULL AND btrim(m.remarks) <> ''
		ORDER BY m.generation ASC NULLS LAST, m.sibling_order ASC NULLS LAST, m.id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := make([]domain.Member, 0)
	for rows.Next() {
		member, err := scanMember(rows)
		if err != nil {
			return nil, err
		}
		members = append(members, member)
	}
	return members, rows.Err()
}

func (s *Store) ListMembersForStatistics(ctx context.Context) ([]domain.StatisticsMember, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, gender, generation, COALESCE(is_alive, true) AS is_alive, birthday::text
		FROM public.family_members
		ORDER BY generation ASC NULLS LAST, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := make([]domain.StatisticsMember, 0)
	for rows.Next() {
		var member domain.StatisticsMember
		if err := rows.Scan(&member.ID, &member.Name, &member.Gender, &member.Generation, &member.IsAlive, &member.Birthday); err != nil {
			return nil, err
		}
		members = append(members, member)
	}
	return members, rows.Err()
}

func (s *Store) GetMember(ctx context.Context, id int64) (domain.Member, error) {
	return scanMember(s.pool.QueryRow(ctx, `SELECT`+memberColumns+memberFrom+` WHERE m.id = $1`, id))
}

func (s *Store) CreateMember(ctx context.Context, input domain.MemberInput) (domain.Member, error) {
	isAlive := true
	if input.IsAlive != nil {
		isAlive = *input.IsAlive
	}
	var id int64
	err := s.pool.QueryRow(ctx, `
		INSERT INTO public.family_members
			(name, generation, sibling_order, father_id, gender, official_position,
			 is_alive, spouse, remarks, birthday, death_date, birth_date_raw, death_date_raw,
			 residence_place)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11::date, $12, $13, $14)
		RETURNING id`,
		input.Name, input.Generation, input.SiblingOrder, input.FatherID, input.Gender,
		input.OfficialPosition, isAlive, input.Spouse, input.Remarks, input.Birthday,
		input.DeathDate, input.BirthDateRaw, input.DeathDateRaw, input.ResidencePlace,
	).Scan(&id)
	if err != nil {
		return domain.Member{}, mapMemberWriteError(err)
	}
	return s.GetMember(ctx, id)
}

func (s *Store) UpdateMember(ctx context.Context, id int64, input domain.MemberInput) (domain.Member, error) {
	isAlive := true
	if input.IsAlive != nil {
		isAlive = *input.IsAlive
	}
	// 原始日期文本只在调用方显式提供，或日期本身未变化时保留：
	// 表格编辑只更新 ISO 日期，若日期被改动则旧的 GEDCOM 原文已失效，需要一并清空。
	tag, err := s.pool.Exec(ctx, `
		UPDATE public.family_members SET
			name = $2, generation = $3, sibling_order = $4, father_id = $5,
			gender = $6, official_position = $7, is_alive = $8, spouse = $9,
			remarks = $10,
			birth_date_raw = CASE
				WHEN $13::text IS NOT NULL THEN $13::text
				WHEN $11::date IS DISTINCT FROM birthday THEN NULL
				ELSE birth_date_raw
			END,
			birthday = $11::date,
			death_date_raw = CASE
				WHEN $14::text IS NOT NULL THEN $14::text
				WHEN $12::date IS DISTINCT FROM death_date THEN NULL
				ELSE death_date_raw
			END,
			death_date = $12::date,
			residence_place = $15, updated_at = now()
		WHERE id = $1`,
		id, input.Name, input.Generation, input.SiblingOrder, input.FatherID, input.Gender,
		input.OfficialPosition, isAlive, input.Spouse, input.Remarks, input.Birthday,
		input.DeathDate, input.BirthDateRaw, input.DeathDateRaw, input.ResidencePlace,
	)
	if err != nil {
		return domain.Member{}, mapMemberWriteError(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.Member{}, domain.ErrNotFound
	}
	return s.GetMember(ctx, id)
}

func (s *Store) DeleteMembers(ctx context.Context, ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	tag, err := s.pool.Exec(ctx, `DELETE FROM public.family_members WHERE id = ANY($1)`, ids)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			return 0, domain.ErrHasChildren
		}
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ValidateFather 确认父亲存在，并阻止自引用或祖先环。
func (s *Store) ValidateFather(ctx context.Context, memberID, fatherID int64) error {
	var exists bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM public.family_members WHERE id = $1)`, fatherID,
	).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return domain.ErrInvalidFather
	}
	if memberID == 0 {
		return nil
	}
	if memberID == fatherID {
		return domain.ErrCycle
	}
	var cycle bool
	if err := s.pool.QueryRow(ctx, `
		WITH RECURSIVE ancestors AS (
			SELECT id, father_id FROM public.family_members WHERE id = $1
			UNION
			SELECT m.id, m.father_id
			FROM public.family_members m
			JOIN ancestors a ON m.id = a.father_id
		)
		SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = $2)`, fatherID, memberID,
	).Scan(&cycle); err != nil {
		return err
	}
	if cycle {
		return domain.ErrCycle
	}
	return nil
}

func mapMemberWriteError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23503":
			// family_members 当前唯一的外键是 father_id。
			return domain.ErrInvalidFather
		case "23505":
			return domain.ErrDuplicate
		case "23514":
			return fmt.Errorf("数据不符合约束：%w", err)
		}
	}
	return err
}
