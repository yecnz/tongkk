import { describe, it, expect } from "vitest";
import { isShortAnswerCorrect } from "./answerMatch";

// 단답형 채점은 순서가 다르거나 자잘한 오타가 있어도 같은 답이면 정답으로 봐야 한다.
// 동시에 반의어·숫자 차이·부분답처럼 "비슷하지만 틀린" 답은 오답으로 남아야 한다.
describe("isShortAnswerCorrect", () => {
  describe("정답으로 인정해야 하는 경우", () => {
    it("같은 단어를 순서만 바꾼 답을 인정한다(Q1)", () => {
      expect(isShortAnswerCorrect("2차 대사산물, 유독성", "유독성 2차 대사산물")).toBe(true);
    });

    it("리스트 순서 변경 + 라틴 단어 1글자 오타를 인정한다(Q2)", () => {
      expect(
        isShortAnswerCorrect("Penicilliium, Fusarium, Aspergillus", "Aspergillus, Penicillium, Fusarium"),
      ).toBe(true);
    });

    it("정확히 같은 단일 답은 그대로 정답이다", () => {
      expect(isShortAnswerCorrect("세포막", "세포막")).toBe(true);
    });

    it("대소문자·전각 차이를 흡수한다", () => {
      expect(isShortAnswerCorrect("ATP", "ａｔｐ")).toBe(true);
    });

    it("한국어 단어 내부 공백 차이를 흡수한다", () => {
      expect(isShortAnswerCorrect("미토 콘드리아", "미토콘드리아")).toBe(true);
    });

    it("구분자가 달라도(가운뎃점·일본어 쉼표) 같은 멀티셋으로 본다", () => {
      expect(
        isShortAnswerCorrect("Aspergillus、Penicillium・Fusarium", "Aspergillus, Penicillium, Fusarium"),
      ).toBe(true);
    });
  });

  describe("오답으로 남아야 하는 경우(거짓 양성 가드)", () => {
    it("한 음절만 다른 한국어 반의어는 오답이다", () => {
      expect(isShortAnswerCorrect("열성유전자", "우성유전자")).toBe(false);
    });

    it("숫자만 다른 토큰은 오답이다", () => {
      expect(isShortAnswerCorrect("3차 대사산물, 유독성", "유독성 2차 대사산물")).toBe(false);
    });

    it("토큰 수가 부족한 부분답은 오답이다", () => {
      expect(isShortAnswerCorrect("Aspergillus, Penicillium", "Aspergillus, Penicillium, Fusarium")).toBe(false);
    });

    it("항목 하나가 진짜 다른 답은 오답이다", () => {
      expect(
        isShortAnswerCorrect("Aspergillus, Penicillium, Mucor", "Aspergillus, Penicillium, Fusarium"),
      ).toBe(false);
    });

    it("길이 8 미만의 라틴 근접쌍은 오타 허용하지 않는다", () => {
      expect(isShortAnswerCorrect("serene", "serine")).toBe(false);
    });

    it("잉여 토큰을 덧붙인 답은 오답이다", () => {
      expect(isShortAnswerCorrect("유독성 2차 대사산물 추가", "유독성 2차 대사산물")).toBe(false);
    });

    it("빈 학생 답은 오답이다", () => {
      expect(isShortAnswerCorrect("", "세포막")).toBe(false);
    });
  });
});
