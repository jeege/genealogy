"use server";

import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import type { FamilyMember } from "../actions";
import { createClient } from "@/lib/supabase/server";

export interface StatisticsData {
  totalMembers: number;
  genderStats: { name: string; value: number; fill: string }[];
  generationStats: { name: string; value: number }[];
  statusStats: { name: string; value: number; fill: string }[];
  ageStats: { name: string; value: number }[];
  commonNames: { name: string; count: number }[];
}

export async function fetchFamilyStatistics(): Promise<{
  data: StatisticsData | null;
  error: string | null;
}> {
  const supabase = await createClient();

  // 完整加载统计所需字段后再计算各分类。
  const { data: members, error } = await fetchAllRows<
    Pick<FamilyMember, "id" | "name" | "gender" | "generation" | "is_alive" | "birthday">
  >((from, to) =>
    supabase.from("family_members")
      .select("id, name, gender, generation, is_alive, birthday", { count: "exact" })
      .order("generation", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );

  if (error) return { data: null, error };

  const totalMembers = members.length;

  // 1. Gender Statistics
  const genderCounts = members.reduce(
    (acc, member) => {
      const gender = member.gender || "未知";
      acc[gender] = (acc[gender] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const genderStats = [
    { name: "男", value: genderCounts["男"] || 0, fill: "#3b82f6" }, // blue-500
    { name: "女", value: genderCounts["女"] || 0, fill: "#ec4899" }, // pink-500
  ];
  if (genderCounts["未知"]) {
    genderStats.push({
      name: "未知",
      value: genderCounts["未知"],
      fill: "#94a3b8",
    }); // slate-400
  }

  // 2. Generation Statistics
  const generationCounts = members.reduce(
    (acc, member) => {
      const gen = member.generation ? `第${member.generation}世` : "未知";
      acc[gen] = (acc[gen] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // Sort generations properly
  const sortedGenerations = Object.keys(generationCounts).sort((a, b) => {
    if (a === "未知") return 1;
    if (b === "未知") return -1;
    const genA = parseInt(a.replace(/\D/g, ""));
    const genB = parseInt(b.replace(/\D/g, ""));
    return genA - genB;
  });

  const generationStats = sortedGenerations.map((gen) => ({
    name: gen,
    value: generationCounts[gen],
  }));

  // 3. Status Statistics (Alive vs Deceased)
  const statusCounts = members.reduce(
    (acc, member) => {
      const status = member.is_alive ? "在世" : "已故";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const statusStats = [
    { name: "在世", value: statusCounts["在世"] || 0, fill: "#22c55e" }, // green-500
    { name: "已故", value: statusCounts["已故"] || 0, fill: "#64748b" }, // slate-500
  ];

  // 4. Age Statistics (for Living Members with Birthday)
  const now = new Date();
  const ageGroups: Record<string, number> = {
    "0-10岁": 0,
    "11-20岁": 0,
    "21-30岁": 0,
    "31-40岁": 0,
    "41-50岁": 0,
    "51-60岁": 0,
    "61-70岁": 0,
    "71-80岁": 0,
    "80岁以上": 0,
  };

  members.forEach((member) => {
    if (member.is_alive && member.birthday) {
      const birthDate = new Date(member.birthday);
      let age = now.getFullYear() - birthDate.getFullYear();
      const m = now.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < birthDate.getDate())) {
        age--;
      }

      if (age <= 10) ageGroups["0-10岁"]++;
      else if (age <= 20) ageGroups["11-20岁"]++;
      else if (age <= 30) ageGroups["21-30岁"]++;
      else if (age <= 40) ageGroups["31-40岁"]++;
      else if (age <= 50) ageGroups["41-50岁"]++;
      else if (age <= 60) ageGroups["51-60岁"]++;
      else if (age <= 70) ageGroups["61-70岁"]++;
      else if (age <= 80) ageGroups["71-80岁"]++;
      else ageGroups["80岁以上"]++;
    }
  });

  const ageStats = Object.entries(ageGroups).map(([name, value]) => ({
    name,
    value,
  }));

  // 5. Common Names (Last character of name usually indicates generation name in some families, or just frequent names)
  // Here we just count full names (duplicates) or maybe last character if we want to guess 'Zi' (style name) usage?
  // Let's stick to just "Most common names" (duplicates) for now, or maybe "Given Name" frequency?
  // Chinese names: Surname (1-2 chars) + Given Name (1-2 chars).
  // Assuming full names are stored, getting the most frequent last character might be interesting for 'Generation Name' detection.
  // Let's try to count the specific characters in names (excluding the first character as surname, assuming 1 char surname for simplicity or just count all chars in given name).
  // Simple approach: Count full names (detect duplicates) and maybe the second character (often generation name).

  // Let's do: Most frequent Given Names (excluding surname). Assuming surname is 1st char for now (imperfect but simple).
  // Better: Just simple duplicate name check.
  const nameCounts: Record<string, number> = {};
  members.forEach((m) => {
    // Naive assumption: First char is surname.
    const givenName = m.name.length > 1 ? m.name.substring(1) : m.name;
    // Count individual characters in given name for "Generation Name" (Zi) trends?
    // Or just count the full name if duplicates exist.
    // Let's count the 2nd character (often generation character).
    if (m.name.length >= 2) {
      const genChar = m.name[1]; // 2nd character
      nameCounts[genChar] = (nameCounts[genChar] || 0) + 1;
    }
  });

  const commonNames = Object.entries(nameCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  return {
    data: {
      totalMembers,
      genderStats,
      generationStats,
      statusStats,
      ageStats,
      commonNames,
    },
    error: null,
  };
}
