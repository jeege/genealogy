package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

const marriageColumns = `
	m.id, m.husband_id, h.name, m.wife_id, w.name,
	m.status, m.married_on::text, m.divorced_on::text,
	m.married_on_raw, m.divorced_on_raw, m.note, m.updated_at`

const marriageFrom = `
	FROM public.marriages m
	JOIN public.family_members h ON h.id = m.husband_id
	LEFT JOIN public.family_members w ON w.id = m.wife_id`

func scanMarriage(row pgx.Row) (domain.Marriage, error) {
	var marriage domain.Marriage
	err := row.Scan(
		&marriage.ID, &marriage.HusbandID, &marriage.Husband, &marriage.WifeID, &marriage.Wife,
		&marriage.Status, &marriage.MarriedOn, &marriage.DivorcedOn,
		&marriage.MarriedOnRaw, &marriage.DivorcedOnRaw, &marriage.Note, &marriage.UpdatedAt,
	)
	if err != nil {
		return domain.Marriage{}, normalizeNotFound(err)
	}
	return marriage, nil
}

// ListMarriages 返回某位成员的全部婚姻（无论作为丈夫还是妻子）。
func (s *Store) ListMarriages(ctx context.Context, memberID int64) ([]domain.Marriage, error) {
	rows, err := s.pool.Query(ctx, `SELECT`+marriageColumns+marriageFrom+`
		WHERE m.husband_id = $1 OR m.wife_id = $1
		ORDER BY m.married_on NULLS LAST, m.id`, memberID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	marriages := make([]domain.Marriage, 0, 4)
	for rows.Next() {
		marriage, err := scanMarriage(rows)
		if err != nil {
			return nil, err
		}
		marriages = append(marriages, marriage)
	}
	return marriages, rows.Err()
}

// ListSpouseLinks 批量返回成员 ID → 配偶摘要，供列表和关系图使用。
func (s *Store) ListSpouseLinks(ctx context.Context, memberIDs []int64) (map[int64][]domain.SpouseLink, error) {
	result := make(map[int64][]domain.SpouseLink, len(memberIDs))
	if len(memberIDs) == 0 {
		return result, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT m.id, m.husband_id, h.name, m.wife_id, w.name, m.status
		FROM public.marriages m
		JOIN public.family_members h ON h.id = m.husband_id
		LEFT JOIN public.family_members w ON w.id = m.wife_id
		WHERE m.husband_id = ANY($1) OR m.wife_id = ANY($1)
		ORDER BY m.married_on NULLS LAST, m.id`, memberIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var marriageID int64
		var husbandID int64
		var husbandName string
		var wifeID *int64
		var wifeName *string
		var status string
		if err := rows.Scan(&marriageID, &husbandID, &husbandName, &wifeID, &wifeName, &status); err != nil {
			return nil, err
		}
		addLink := func(memberID int64, partnerID *int64, name string) {
			if name == "" {
				name = "未命名"
			}
			result[memberID] = append(result[memberID], domain.SpouseLink{
				MarriageID: marriageID,
				PartnerID:  partnerID,
				Name:       name,
				Status:     status,
			})
		}
		if wifeID != nil {
			addLink(husbandID, wifeID, *wifeName)
			addLink(*wifeID, &husbandID, husbandName)
		}
	}
	return result, rows.Err()
}

// ListAllMarriages 返回全部配偶关系，供 GEDCOM 导出使用。
func (s *Store) ListAllMarriages(ctx context.Context) ([]domain.Marriage, error) {
	rows, err := s.pool.Query(ctx, `SELECT`+marriageColumns+marriageFrom+`
		ORDER BY m.husband_id, m.wife_id NULLS LAST, m.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	marriages := make([]domain.Marriage, 0, 64)
	for rows.Next() {
		marriage, err := scanMarriage(rows)
		if err != nil {
			return nil, err
		}
		marriages = append(marriages, marriage)
	}
	return marriages, rows.Err()
}

// GetMarriage 读取单段婚姻。
func (s *Store) GetMarriage(ctx context.Context, id int64) (domain.Marriage, error) {
	return scanMarriage(s.pool.QueryRow(ctx, `SELECT`+marriageColumns+marriageFrom+` WHERE m.id = $1`, id))
}

// CreateMarriage 新增配偶关系并校验成员存在与不重复。
func (s *Store) CreateMarriage(ctx context.Context, input domain.MarriageInput) (domain.Marriage, error) {
	if err := s.validateMarriage(ctx, 0, input); err != nil {
		return domain.Marriage{}, err
	}
	var id int64
	err := s.pool.QueryRow(ctx, `
		INSERT INTO public.marriages
			(husband_id, wife_id, status, married_on, divorced_on, married_on_raw, divorced_on_raw, note)
		VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8)
		RETURNING id`,
		input.HusbandID, input.WifeID, input.Status, input.MarriedOn, input.DivorcedOn,
		input.MarriedOnRaw, input.DivorcedOnRaw, input.Note,
	).Scan(&id)
	if err != nil {
		return domain.Marriage{}, mapMarriageError(err)
	}
	return s.GetMarriage(ctx, id)
}

// UpdateMarriage 更新婚姻状态与时间。
func (s *Store) UpdateMarriage(ctx context.Context, id int64, input domain.MarriageInput) (domain.Marriage, error) {
	// 先确认记录存在，避免把「不存在」误报成配偶重复。
	var exists bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM public.marriages WHERE id = $1)`, id,
	).Scan(&exists); err != nil {
		return domain.Marriage{}, err
	}
	if !exists {
		return domain.Marriage{}, domain.ErrNotFound
	}
	if err := s.validateMarriage(ctx, id, input); err != nil {
		return domain.Marriage{}, err
	}
	// 参数顺序：$1 id、$2 husband、$3 wife、$4 status、$5 married_on、
	// $6 divorced_on、$7 married_on_raw、$8 note、$9 divorced_on_raw。
	// 每个占位符只承担一种类型，避免 PostgreSQL 推断出冲突类型。
	tag, err := s.pool.Exec(ctx, `
		UPDATE public.marriages SET
			husband_id = $2,
			wife_id = $3,
			status = $4,
			married_on_raw = CASE
				WHEN $7::text IS NOT NULL THEN $7::text
				WHEN $5::date IS DISTINCT FROM married_on THEN NULL
				ELSE married_on_raw
			END,
			married_on = $5::date,
			divorced_on_raw = CASE
				WHEN $9::text IS NOT NULL THEN $9::text
				WHEN $6::date IS DISTINCT FROM divorced_on THEN NULL
				ELSE divorced_on_raw
			END,
			divorced_on = $6::date,
			note = $8,
			updated_at = now()
		WHERE id = $1`,
		id, input.HusbandID, input.WifeID, input.Status,
		input.MarriedOn, input.DivorcedOn, input.MarriedOnRaw, input.Note, input.DivorcedOnRaw,
	)
	if err != nil {
		return domain.Marriage{}, mapMarriageError(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.Marriage{}, domain.ErrNotFound
	}
	return s.GetMarriage(ctx, id)
}

// DeleteMarriage 解除一段配偶关系。
func (s *Store) DeleteMarriage(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM public.marriages WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ReplaceSpouses 用给定成员 ID 集合替换某成员的全部配偶关系。
// 保留已存在的配对（连同其婚姻日期与备注），只新增/删除差异部分。
func (s *Store) ReplaceSpouses(ctx context.Context, memberID int64, spouseIDs []int64, note *string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	existing, err := listMarriageIDs(tx, ctx, memberID)
	if err != nil {
		return err
	}

	desired := make(map[int64]bool, len(spouseIDs))
	for _, spouseID := range spouseIDs {
		if spouseID == memberID {
			return &domain.MarriageValidationError{Message: "不能把自己设为配偶"}
		}
		if desired[spouseID] {
			continue
		}
		desired[spouseID] = true
		// 校验配偶成员存在。
		var exists bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM public.family_members WHERE id = $1)`, spouseID,
		).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return domain.ErrInvalidSpouse
		}
		if _, ok := existing[spouseID]; ok {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.marriages (husband_id, wife_id, status, note)
			VALUES ($1, $2, 'married', $3)
			ON CONFLICT DO NOTHING`, memberID, spouseID, note); err != nil {
			return mapMarriageError(err)
		}
	}
	for spouseID, marriageID := range existing {
		if desired[spouseID] {
			continue
		}
		if _, err := tx.Exec(ctx, `DELETE FROM public.marriages WHERE id = $1`, marriageID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// listMarriageIDs 返回某成员现有配偶集合：配偶成员 ID → 婚姻 ID。
func listMarriageIDs(tx pgx.Tx, ctx context.Context, memberID int64) (map[int64]int64, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, husband_id, wife_id FROM public.marriages
		WHERE husband_id = $1 OR wife_id = $1`, memberID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[int64]int64, 2)
	for rows.Next() {
		var marriageID, husbandID int64
		var wifeID *int64
		if err := rows.Scan(&marriageID, &husbandID, &wifeID); err != nil {
			return nil, err
		}
		if wifeID != nil {
			if husbandID == memberID {
				result[*wifeID] = marriageID
			} else {
				result[husbandID] = marriageID
			}
		}
	}
	return result, rows.Err()
}

func (s *Store) validateMarriage(ctx context.Context, marriageID int64, input domain.MarriageInput) error {
	if input.HusbandID <= 0 {
		return &domain.MarriageValidationError{Message: "请选择配偶关系中的丈夫"}
	}
	if input.WifeID != nil && *input.WifeID == input.HusbandID {
		return &domain.MarriageValidationError{Message: "丈夫与妻子不能是同一个人"}
	}
	for _, memberID := range []int64{input.HusbandID, derefOrZero(input.WifeID)} {
		if memberID == 0 {
			continue
		}
		var exists bool
		if err := s.pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM public.family_members WHERE id = $1)`, memberID,
		).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return domain.ErrInvalidSpouse
		}
	}
	if input.DivorcedOn != nil && input.MarriedOn != nil && *input.DivorcedOn < *input.MarriedOn {
		return &domain.MarriageValidationError{Message: "解除婚姻日期不能早于结婚日期"}
	}
	if input.Status != "" &&
		input.Status != domain.MarriageMarried &&
		input.Status != domain.MarriageDivorced &&
		input.Status != domain.MarriageWidowed {
		return &domain.MarriageValidationError{Message: "婚姻状态无效"}
	}
	if marriageID != 0 && input.WifeID != nil {
		// 检查是否与另一段记录重复（同一对成员）。
		var duplicate bool
		if err := s.pool.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM public.marriages
				WHERE id <> $1 AND husband_id = $2 AND wife_id = $3
			)`, marriageID, input.HusbandID, *input.WifeID,
		).Scan(&duplicate); err != nil {
			return err
		}
		if duplicate {
			return &domain.MarriageValidationError{Message: "这两位成员之间已存在配偶关系"}
		}
	}
	return nil
}

func derefOrZero(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func mapMarriageError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23503":
			return domain.ErrInvalidSpouse
		case "23505":
			return &domain.MarriageValidationError{Message: "这两位成员之间已存在配偶关系"}
		case "23514":
			return &domain.MarriageValidationError{Message: "配偶关系数据不符合约束"}
		}
	}
	return fmt.Errorf("配偶关系操作失败：%w", err)
}
