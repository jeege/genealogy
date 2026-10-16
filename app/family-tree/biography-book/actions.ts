"use server";

import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import { fetchMemberNamesByIds } from "../member-queries";
import type { FamilyMember } from "../actions";
import { createClient } from "@/lib/supabase/server";

export interface BiographyMember {
    id: number;
    name: string;
    generation: number | null;
    sibling_order: number | null;
    gender: "男" | "女" | null;
    birthday: string | null;
    death_date: string | null;
    is_alive: boolean;
    spouse: string | null;
    official_position: string | null;
    residence_place: string | null;
    remarks: string;
    father_name: string | null;
}

/**
 * 获取所有有生平事迹的成员，用于生平册展示
 */
export async function fetchMembersWithBiography(): Promise<{
    data: BiographyMember[];
    error: string | null;
}> {
    const supabase = await createClient();

    // 查询有 remarks 的成员
    const { data, error } = await fetchAllRows<FamilyMember>((from, to) =>
        supabase.from("family_members")
            .select("*", { count: "exact" })
            .not("remarks", "is", null)
            .neq("remarks", "")
            .order("generation", { ascending: true })
            .order("sibling_order", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to)
    );

    if (error) return { data: [], error };

    // 过滤掉 remarks 只是空的 JSON 结构的情况
    const validData = data.filter((item): item is FamilyMember & { remarks: string } => {
        if (!item.remarks) return false;
        try {
            const parsed = JSON.parse(item.remarks);
            // 检查是否有实质内容
            if (Array.isArray(parsed)) {
                return parsed.some((node: any) => {
                    if (node.children && Array.isArray(node.children)) {
                        return node.children.some((child: any) => child.text && child.text.trim());
                    }
                    return false;
                });
            }
            return false;
        } catch {
            // 如果不是 JSON，检查是否为非空字符串
            return item.remarks.trim().length > 0;
        }
    });

    // 获取所有父亲 ID
    const fatherIds = validData
        .map((item) => item.father_id)
        .filter((id): id is number => id !== null);

    const { data: fathers, error: fatherError } = await fetchMemberNamesByIds(supabase, fatherIds);
    if (fatherError) return { data: [], error: fatherError };
    const fatherMap: Record<number, string> = Object.fromEntries(fathers.map((father) => [father.id, father.name]));

    // 转换数据格式
    const transformedData: BiographyMember[] = validData.map((item) => ({
        id: item.id,
        name: item.name,
        generation: item.generation,
        sibling_order: item.sibling_order,
        gender: item.gender,
        birthday: item.birthday,
        death_date: item.death_date,
        is_alive: item.is_alive,
        spouse: item.spouse,
        official_position: item.official_position,
        residence_place: item.residence_place,
        remarks: item.remarks,
        father_name: item.father_id ? fatherMap[item.father_id] || null : null,
    }));

    return { data: transformedData, error: null };
}
