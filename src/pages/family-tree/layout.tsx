import { FamilyTreeHeader } from "@/components/family-tree-header";

export default function FamilyTreeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <FamilyTreeHeader />
      <main className="flex-1">{children}</main>
    </div>
  );
}
