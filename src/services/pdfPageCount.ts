import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";

GlobalWorkerOptions.workerSrc = workerSrc;

export async function getPdfPageCount(file: File): Promise<number | null> {
  try {
    const data = await file.arrayBuffer();
    const loadingTask = getDocument({ data });
    const pdf = await loadingTask.promise;

    try {
      return pdf.numPages;
    } finally {
      await pdf.destroy();
    }
  } catch {
    return null;
  }
}
