export async function hasNewWebBuild(): Promise<boolean> {
  const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to check the Tongkk web build");
  const data = (await response.json()) as { buildId?: string };
  if (!data.buildId) throw new Error("Missing Tongkk web build ID");
  return data.buildId !== __BUILD_ID__;
}
