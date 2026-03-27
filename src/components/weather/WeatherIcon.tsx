import React from 'react';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';

type WeatherIconProps = {
  icon: string;
  size?: number;
};

const COLORS = {
  sun: '#FDB813',
  sunGlow: '#FFE29A',
  cloud: '#E6E9EF',
  cloudShadow: '#C9D1DC',
  rain: '#4A90E2',
  lightning: '#FFC400',
  snow: '#B3E5FC',
  fog: '#B0BEC5',
  night: '#90A4AE',
  nightGlow: '#E1F5FE',
};

const iconKind = (icon: string) => {
  const key = icon.toLowerCase();
  if (key.includes('lightning')) return 'lightning';
  if (key.includes('pouring')) return 'pouring';
  if (key.includes('rain')) return 'rainy';
  if (key.includes('snow')) return 'snowy';
  if (key.includes('fog')) return 'fog';
  if (key.includes('night')) return 'night';
  if (key.includes('sunny')) return 'sunny';
  return 'cloudy';
};

const Cloud = () => (
  <G>
    <Path
      d="M20 40h24a10 10 0 0 0 0-20 14 14 0 0 0-27-4A12 12 0 0 0 20 40z"
      fill={COLORS.cloudShadow}
      opacity={0.35}
      transform="translate(2 2)"
    />
    <Path
      d="M20 40h24a10 10 0 0 0 0-20 14 14 0 0 0-27-4A12 12 0 0 0 20 40z"
      fill={COLORS.cloud}
    />
  </G>
);

const Sun = () => (
  <G>
    <Circle cx="20" cy="20" r="9" fill={COLORS.sunGlow} opacity={0.8} />
    <Circle cx="20" cy="20" r="7" fill={COLORS.sun} />
    <G stroke={COLORS.sun} strokeWidth="3" strokeLinecap="round">
      <Line x1="20" y1="4" x2="20" y2="10" />
      <Line x1="20" y1="30" x2="20" y2="36" />
      <Line x1="4" y1="20" x2="10" y2="20" />
      <Line x1="30" y1="20" x2="36" y2="20" />
      <Line x1="8" y1="8" x2="12" y2="12" />
      <Line x1="28" y1="28" x2="32" y2="32" />
      <Line x1="8" y1="32" x2="12" y2="28" />
      <Line x1="28" y1="12" x2="32" y2="8" />
    </G>
  </G>
);

const Moon = () => (
  <G>
    <Path
      d="M42 14a14 14 0 1 0 8 26 12 12 0 0 1-8-26z"
      fill={COLORS.nightGlow}
    />
    <Circle cx="46" cy="12" r="2" fill={COLORS.night} />
  </G>
);

const Rain = ({ heavy = false }: { heavy?: boolean }) => (
  <G stroke={COLORS.rain} strokeWidth={heavy ? 3.5 : 3} strokeLinecap="round">
    <Line x1="24" y1="44" x2="20" y2="54" />
    <Line x1="34" y1="44" x2="30" y2="56" />
    <Line x1="44" y1="44" x2="40" y2="54" />
  </G>
);

const Snow = () => (
  <G fill={COLORS.snow}>
    <Circle cx="26" cy="50" r="2.5" />
    <Circle cx="36" cy="54" r="2.5" />
    <Circle cx="46" cy="50" r="2.5" />
  </G>
);

const Fog = () => (
  <G stroke={COLORS.fog} strokeWidth="3" strokeLinecap="round">
    <Line x1="16" y1="46" x2="48" y2="46" />
    <Line x1="20" y1="52" x2="44" y2="52" />
    <Line x1="18" y1="58" x2="46" y2="58" />
  </G>
);

const Lightning = () => (
  <Path
    d="M34 42l-8 12h6l-4 10 14-16h-6l6-6z"
    fill={COLORS.lightning}
  />
);

export const WeatherIcon: React.FC<WeatherIconProps> = ({ icon, size = 40 }) => {
  const type = iconKind(icon);

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      {type === 'sunny' && (
        <G>
          <Sun />
          <Cloud />
        </G>
      )}
      {type === 'cloudy' && <Cloud />}
      {type === 'rainy' && (
        <G>
          <Cloud />
          <Rain />
        </G>
      )}
      {type === 'pouring' && (
        <G>
          <Cloud />
          <Rain heavy />
        </G>
      )}
      {type === 'lightning' && (
        <G>
          <Cloud />
          <Lightning />
          <Rain />
        </G>
      )}
      {type === 'snowy' && (
        <G>
          <Cloud />
          <Snow />
        </G>
      )}
      {type === 'fog' && (
        <G>
          <Cloud />
          <Fog />
        </G>
      )}
      {type === 'night' && (
        <G>
          <Moon />
          <Cloud />
        </G>
      )}
    </Svg>
  );
};
