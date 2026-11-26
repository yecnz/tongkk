type AnswerResult = { selected: number; answer_index: number; correct: boolean };

type Props = {
  name: string;
  options: string[];
  selected: number | null;
  onChange: (index: number) => void;
  result?: AnswerResult | null;
  disabled?: boolean;
  legend?: string;
};

/** The learning session and spaced review use the same answer and feedback cues. */
export default function AnswerOptions({ name, options, selected, onChange, result, disabled, legend = '답안 선택' }: Props) {
  return <fieldset className="learning-check" disabled={disabled || Boolean(result)}><legend>{legend}</legend>
    {options.map((option, index) => <label key={index} className={`learning-option${result?.answer_index === index ? ' is-correct' : result?.selected === index ? ' is-incorrect' : ''}`}>
      <input type="radio" name={name} value={index} checked={(result?.selected ?? selected) === index} onChange={() => onChange(index)} />
      <span className="learning-option-text">{option}</span>
      {result?.answer_index === index && <span className="learning-badge">정답</span>}
      {result && !result.correct && result.selected === index && <span className="learning-badge is-pink">내 선택</span>}
    </label>)}
  </fieldset>;
}
