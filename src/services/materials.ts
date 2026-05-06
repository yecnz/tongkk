export type MaterialKind = "pdf" | "ppt" | "img" | "file";

export type CourseMaterial = {
  id: string;
  name: string;
  size: number | null;
  type: MaterialKind;
  pages: number | null;
  slides: number | null;
  markdown: string;
  updatedAt: number;
};

const materialsKey = (course: string) => `tongkk:materials:${course}`;
const legacyMarkdownKey = (course: string) => `tongkk:markdown:${course}`;
const legacyMaterialKey = (course: string) => `tongkk:material:${course}`;

export const getFileMaterialId = (file: Pick<File, "name" | "size">) => `${file.name}:${file.size}`;

export const getCourseMaterials = (course: string): CourseMaterial[] => {
  const raw = localStorage.getItem(materialsKey(course));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as CourseMaterial[];
      if (Array.isArray(parsed)) return parsed.filter(m => m.markdown);
    } catch {
      // Fall through to legacy migration.
    }
  }

  const legacyMarkdown = localStorage.getItem(legacyMarkdownKey(course));
  if (!legacyMarkdown) return [];

  let legacyMaterial: Partial<CourseMaterial> | null = null;
  const legacyRaw = localStorage.getItem(legacyMaterialKey(course));
  if (legacyRaw) {
    try {
      legacyMaterial = JSON.parse(legacyRaw) as Partial<CourseMaterial>;
    } catch {
      legacyMaterial = null;
    }
  }

  return [{
    id: legacyMaterial?.name && typeof legacyMaterial.size === "number"
      ? `${legacyMaterial.name}:${legacyMaterial.size}`
      : `legacy:${course}`,
    name: legacyMaterial?.name || "파일명 정보 없음",
    size: typeof legacyMaterial?.size === "number" ? legacyMaterial.size : null,
    type: legacyMaterial?.type || "pdf",
    pages: legacyMaterial?.pages ?? null,
    slides: legacyMaterial?.slides ?? null,
    markdown: legacyMarkdown,
    updatedAt: legacyMaterial?.updatedAt || Date.now(),
  }];
};

export const saveCourseMaterials = (course: string, materials: CourseMaterial[]) => {
  localStorage.setItem(materialsKey(course), JSON.stringify(materials));

  const latest = materials[materials.length - 1];
  if (latest) {
    localStorage.setItem(legacyMarkdownKey(course), latest.markdown);
    localStorage.setItem(legacyMaterialKey(course), JSON.stringify({
      name: latest.name,
      size: latest.size,
      type: latest.type,
      pages: latest.pages,
      slides: latest.slides,
      updatedAt: latest.updatedAt,
    }));
  } else {
    localStorage.removeItem(legacyMarkdownKey(course));
    localStorage.removeItem(legacyMaterialKey(course));
  }
};

export const combineMaterialsMarkdown = (materials: CourseMaterial[]) =>
  materials
    .map(material => `# ${material.name}\n\n${material.markdown}`)
    .join("\n\n---\n\n");
