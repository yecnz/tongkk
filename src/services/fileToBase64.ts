/** File → base64 문자열 변환 (브라우저 네이티브 FileReader 사용) */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('파일 읽기 결과가 문자열이 아닙니다.'));
        return;
      }
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

/** 파일 크기 체크 (기본 제한: 15MB) */
export function checkFileSize(file: File, limitMB = 15): void {
  const limitBytes = limitMB * 1024 * 1024;
  if (file.size > limitBytes) {
    throw new Error(`파일이 너무 큽니다. ${limitMB}MB 이하의 PDF를 업로드해주세요. (현재: ${(file.size / 1024 / 1024).toFixed(1)}MB)`);
  }
}
