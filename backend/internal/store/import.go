package store

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
	"github.com/yunfengsa/pure-genealogy/backend/internal/family"
	"github.com/yunfengsa/pure-genealogy/backend/internal/gedcom"
)

func (s *Store) ResolveImportFathers(ctx context.Context, members []domain.ImportMember) ([]*domain.ImportFatherMatch, error) {
	return resolveImportFathers(ctx, s.pool, members)
}

func resolveImportFathers(ctx context.Context, q querier, members []domain.ImportMember) ([]*domain.ImportFatherMatch, error) {
	names := make([]string, 0)
	seen := make(map[string]bool)
	for _, member := range members {
		if member.FatherName == nil || seen[*member.FatherName] {
			continue
		}
		seen[*member.FatherName] = true
		names = append(names, *member.FatherName)
	}
	if len(names) == 0 {
		return family.ResolveImportFathers(members, nil)
	}

	rows, err := q.Query(ctx, `
		SELECT id, name, generation
		FROM public.family_members
		WHERE name = ANY($1)
		ORDER BY id`, names)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	candidates := make([]domain.ImportFatherCandidate, 0)
	for rows.Next() {
		var candidate domain.ImportFatherCandidate
		if err := rows.Scan(&candidate.ID, &candidate.Name, &candidate.Generation); err != nil {
			return nil, err
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return family.ResolveImportFathers(members, candidates)
}

type importKey struct {
	Name       string
	Generation int
}

func importKeyOf(member domain.ImportMember) importKey {
	generation := -1
	if member.Generation != nil {
		generation = *member.Generation
	}
	return importKey{Name: member.Name, Generation: generation}
}

// ImportMembers 在单个事务中按世代从父到子写入；任何错误都会整体回滚。
func (s *Store) ImportMembers(ctx context.Context, members []domain.ImportMember) (int, error) {
	if len(members) == 0 {
		return 0, &family.ValidationError{Message: "没有可导入的成员"}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	fathers, err := resolveImportFathers(ctx, tx, members)
	if err != nil {
		return 0, err
	}

	generations := make(map[int][]int)
	for index, member := range members {
		generation := 0
		if member.Generation != nil {
			generation = *member.Generation
		}
		generations[generation] = append(generations[generation], index)
	}
	orderedGenerations := make([]int, 0, len(generations))
	for generation := range generations {
		orderedGenerations = append(orderedGenerations, generation)
	}
	sort.Ints(orderedGenerations)

	importedIDs := make(map[importKey]int64)
	for _, generation := range orderedGenerations {
		indices := generations[generation]
		for offset := 0; offset < len(indices); offset += 200 {
			end := offset + 200
			if end > len(indices) {
				end = len(indices)
			}
			batch := indices[offset:end]
			if err := insertImportBatch(ctx, tx, members, fathers, batch, importedIDs); err != nil {
				return 0, err
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(members), nil
}

func insertImportBatch(
	ctx context.Context,
	tx pgx.Tx,
	members []domain.ImportMember,
	fathers []*domain.ImportFatherMatch,
	batch []int,
	importedIDs map[importKey]int64,
) error {
	args := make([]any, 0, len(batch)*11)
	placeholders := make([]string, 0, len(batch))
	for position, index := range batch {
		member := members[index]
		var fatherID *int64
		if match := fathers[index]; match != nil {
			switch match.Source {
			case "existing":
				fatherID = match.ID
			case "import":
				if match.Index == nil {
					return &family.ValidationError{Message: "导入父亲的来源索引缺失"}
				}
				father := members[*match.Index]
				id, ok := importedIDs[importKeyOf(father)]
				if !ok {
					name := ""
					if member.FatherName != nil {
						name = *member.FatherName
					}
					return &family.ValidationError{Message: fmt.Sprintf("未取得「%s」的父亲 ID，导入已停止", name)}
				}
				fatherID = &id
			}
		}
		isAlive := true
		if member.IsAlive != nil {
			isAlive = *member.IsAlive
		}
		base := position * 10
		placeholders = append(placeholders, fmt.Sprintf(
			"($%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d::date,$%d)",
			base+1, base+2, base+3, base+4, base+5, base+6, base+7, base+8, base+9, base+10,
		))
		args = append(args,
			member.Name, member.Generation, member.SiblingOrder, fatherID, member.Gender,
			member.OfficialPosition, isAlive, member.Remarks, member.Birthday,
			member.ResidencePlace,
		)
	}

	query := `INSERT INTO public.family_members
		(name, generation, sibling_order, father_id, gender, official_position,
		 is_alive, remarks, birthday, residence_place)
		VALUES ` + strings.Join(placeholders, ",") + `
		RETURNING id, name, generation`

	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return mapMemberWriteError(err)
	}
	defer rows.Close()

	inserted := 0
	for rows.Next() {
		var id int64
		var name string
		var generation *int
		if err := rows.Scan(&id, &name, &generation); err != nil {
			return err
		}
		importedIDs[importKey{Name: name, Generation: generationValue(generation)}] = id
		inserted++
	}
	if err := rows.Err(); err != nil {
		return mapMemberWriteError(err)
	}
	if inserted != len(batch) {
		return fmt.Errorf("写入成员时返回 %d 条，应为 %d 条", inserted, len(batch))
	}
	return nil
}

func generationValue(generation *int) int {
	if generation == nil {
		return -1
	}
	return *generation
}

// ImportGEDCOM 在一个事务内写入 GEDCOM 成员；replace 为 true 时先清空族谱。
func (s *Store) ImportGEDCOM(ctx context.Context, tree *gedcom.ParsedTree, replace bool) (domain.GEDCOMImportResult, error) {
	if tree == nil || len(tree.Members) == 0 {
		return domain.GEDCOMImportResult{}, &family.ValidationError{Message: "没有可导入的成员"}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.GEDCOMImportResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	result, err := gedcom.Import(ctx, tx, tree, gedcom.ImportOptions{Replace: replace})
	if err != nil {
		return domain.GEDCOMImportResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.GEDCOMImportResult{}, err
	}
	return result, nil
}
