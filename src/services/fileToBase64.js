/**
 * File → base64 문자열 변환 (브라우저 네이티브 FileReader 사용)
 * btoa + reduce 방식은 대용량 파일에서 깨질 수 있어서 이 방식 사용
 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // result 형식: "data:application/pdf;base64,XXXXX..."
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

/**
 * 파일 크기 체크 (기본 제한: 15MB)
 */
export function checkFileSize(file, limitMB = 15) {
  const limitBytes = limitMB * 1024 * 1024;
  if (file.size > limitBytes) {
    throw new Error(`파일이 너무 큽니다. ${limitMB}MB 이하의 PDF를 업로드해주세요. (현재: ${(file.size / 1024 / 1024).toFixed(1)}MB)`);
  }
}
