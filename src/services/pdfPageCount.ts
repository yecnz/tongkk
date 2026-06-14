import { getDocument } from "pdfjs-dist";
import { initPdfWorker } from "./pdfWorker";

initPdfWorker();

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
