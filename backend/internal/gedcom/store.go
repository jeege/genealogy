package gedcom

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

// ImportOptions 控制导入行为。
type ImportOptions struct {
	// Replace 为 true 时在同一事务内清空族谱后重建。
	Replace bool
}

// Import 在单个事务内写入解析后的成员，并按 xref 精确建立父子关系。
// 任一步失败都会整体回滚，不会留下半份族谱。
func Import(ctx context.Context, tx pgx.Tx, tree *ParsedTree, options ImportOptions) (domain.GEDCOMImportResult, error) {
	result := domain.GEDCOMImportResult{
		Members:  len(tree.Members),
		Families: tree.Families,
		Warnings: tree.Warnings,
	}
	if len(tree.Members) == 0 {
		return result, fmt.Errorf("没有可导入的成员")
	}

	if options.Replace {
		if _, err := tx.Exec(ctx, `DELETE FROM public.family_members`); err != nil {
			return domain.GEDCOMImportResult{}, fmt.Errorf("清空旧族谱失败：%w", err)
		}
	}

	importedIDs := make(map[string]int64, len(tree.Members))
	// 世代已按父先子后排序；个别缺失世代的记录在后续轮次重试。
	pending := make([]domain.GEDCOMMember, len(tree.Members))
	copy(pending, tree.Members)
	for progress := true; progress && len(pending) > 0; {
		progress = false
		remaining := pending[:0:0]
		for _, member := range pending {
			if member.FatherXref != nil && *member.FatherXref != "" {
				if _, ok := importedIDs[*member.FatherXref]; !ok {
					remaining = append(remaining, member)
					continue
				}
			}
			id, err := insertMember(ctx, tx, member, importedIDs)
			if err != nil {
				return domain.GEDCOMImportResult{}, err
			}
			importedIDs[member.Xref] = id
			progress = true
		}
		if !progress && len(remaining) > 0 {
			// 父亲不在本文件中：以无父成员写入，并提示用户手工关联。
			for _, member := range remaining {
				id, err := insertMember(ctx, tx, member, importedIDs)
				if err != nil {
					return domain.GEDCOMImportResult{}, err
				}
				importedIDs[member.Xref] = id
			}
			result.Warnings = append(result.Warnings,
				fmt.Sprintf("%d 位成员的父亲不在导入文件内，已按无父成员写入", len(remaining)))
			remaining = nil
		}
		pending = remaining
	}

	ids := make([]int64, 0, len(importedIDs))
	for _, id := range importedIDs {
		ids = append(ids, id)
	}

	// 世代缺失时按父亲链补全，只影响本次导入的记录。
	if _, err := tx.Exec(ctx, `
		WITH RECURSIVE lineage AS (
			SELECT id, generation, father_id, 1 AS depth
			FROM public.family_members
			WHERE father_id IS NULL AND id = ANY($1)
			UNION ALL
			SELECT m.id, m.generation, m.father_id, l.depth + 1
			FROM public.family_members m JOIN lineage l ON m.father_id = l.id
			WHERE m.id = ANY($1)
		)
		UPDATE public.family_members m
		SET generation = l.depth
		FROM lineage l
		WHERE m.id = l.id AND m.generation IS NULL`, ids,
	); err != nil {
		return domain.GEDCOMImportResult{}, fmt.Errorf("补全世代失败：%w", err)
	}

	return result, nil
}

func insertMember(ctx context.Context, tx pgx.Tx, member domain.GEDCOMMember, importedIDs map[string]int64) (int64, error) {
	var fatherID *int64
	if member.FatherXref != nil {
		if id, ok := importedIDs[*member.FatherXref]; ok {
			fatherID = &id
		}
	}
	isAlive := true
	if member.IsAlive != nil {
		isAlive = *member.IsAlive
	}
	name := strings.TrimSpace(member.Name)
	if name == "" {
		name = "未命名"
	}

	var id int64
	err := tx.QueryRow(ctx, `
		INSERT INTO public.family_members
			(name, generation, sibling_order, father_id, gender, official_position,
			 is_alive, spouse, remarks, birthday, death_date, birth_date_raw, death_date_raw,
			 residence_place)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11::date, $12, $13, $14)
		RETURNING id`,
		name, member.Generation, member.SiblingOrder, fatherID, member.Gender,
		member.OfficialPosition, isAlive, member.Spouse, member.Remarks,
		dateOrNil(member.Birth), dateOrNil(member.Death),
		rawOrNil(member.Birth), rawOrNil(member.Death), member.ResidencePlace,
	).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("写入成员「%s」失败：%w", name, err)
	}
	return id, nil
}

func dateOrNil(date domain.GEDCOMDate) *string {
	if date.ISO == nil {
		return nil
	}
	return date.ISO
}

func rawOrNil(date domain.GEDCOMDate) *string {
	raw := strings.TrimSpace(date.Raw)
	if raw == "" {
		return nil
	}
	return &raw
}
