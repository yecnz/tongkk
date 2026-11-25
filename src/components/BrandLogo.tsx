import logo from '../../tongkk-logo-name.png';
import './BrandLogo.css';

export default function BrandLogo({ large = false }: { large?: boolean }) {
  return <img className={`brand-logo${large ? ' brand-logo-large' : ''}`} src={logo} alt="Tongkk" width={large ? 216 : 108} height={large ? 72 : 36} decoding="async" />;
}
