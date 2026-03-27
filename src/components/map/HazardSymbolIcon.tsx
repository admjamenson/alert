import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

type Props = {
  eventType?: string;
  fallbackIcon?: string;
  size?: number;
  color?: string;
};

const BaseSvg = ({
  children,
  size,
  color,
}: {
  children: React.ReactNode;
  size: number;
  color: string;
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {children}
    <Path d="M0 0" stroke={color} />
  </Svg>
);

const renderCustomHazard = (type: string, size: number, color: string) => {
  if (type === 'hurricane' || type === 'cyclone' || type === 'tornado') {
    return (
      <BaseSvg size={size} color={color}>
        <Path d="M5 9.5C6.8 6.8 10 5.6 12.8 6.2C14.7 6.6 16.2 8.2 16.2 10C16.2 11.9 14.7 13.4 12.8 13.4C11.5 13.4 10.4 12.3 10.4 11C10.4 9.9 11.3 9 12.4 9C13.2 9 13.8 9.6 13.8 10.4" stroke={color} strokeWidth={2} strokeLinecap="round" />
        <Path d="M19 14.5C17.2 17.2 14 18.4 11.2 17.8C9.3 17.4 7.8 15.8 7.8 14C7.8 12.1 9.3 10.6 11.2 10.6C12.5 10.6 13.6 11.7 13.6 13C13.6 14.1 12.7 15 11.6 15C10.8 15 10.2 14.4 10.2 13.6" stroke={color} strokeWidth={2} strokeLinecap="round" />
        <Circle cx="12" cy="12" r="1.2" fill={color} />
      </BaseSvg>
    );
  }

  if (type === 'avalanche') {
    return (
      <BaseSvg size={size} color={color}>
        <Path d="M3.8 18.8L9.3 7.6L14.9 18.8H3.8Z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
        <Path d="M10.8 18.8L15.9 9L20.2 18.8H10.8Z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
        <Circle cx="14.7" cy="7.2" r="1.1" fill={color} />
        <Circle cx="16.7" cy="8.8" r="1.1" fill={color} />
        <Circle cx="18.6" cy="10.6" r="1.1" fill={color} />
      </BaseSvg>
    );
  }

  if (type === 'heatwave' || type === 'heat') {
    return (
      <BaseSvg size={size} color={color}>
        <Circle cx="8.2" cy="8" r="2.3" stroke={color} strokeWidth={1.8} />
        <Path d="M8.2 3.8V2.4M8.2 13.6V12.2M12.4 8H13.8M2.6 8H4M11.2 4.9L12.1 4M4.3 11.8L5.2 10.9M11.2 11.1L12.1 12M4.3 4.2L5.2 5.1" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
        <Path d="M7 16.5C8.2 15.2 9.4 15.2 10.6 16.5C11.8 17.8 13 17.8 14.2 16.5C15.4 15.2 16.6 15.2 17.8 16.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
        <Path d="M7 20C8.2 18.7 9.4 18.7 10.6 20C11.8 21.3 13 21.3 14.2 20C15.4 18.7 16.6 18.7 17.8 20" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      </BaseSvg>
    );
  }

  if (type === 'tsunami' || type === 'high_tide' || type === 'rogue_waves') {
    return (
      <BaseSvg size={size} color={color}>
        <Path d="M3 14C4.8 14 4.8 11 6.6 11C8.4 11 8.4 14 10.2 14C12 14 12 11 13.8 11C15.6 11 15.6 14 17.4 14C19.2 14 19.2 11 21 11" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
        <Path d="M3 18C4.8 18 4.8 15 6.6 15C8.4 15 8.4 18 10.2 18C12 18 12 15 13.8 15C15.6 15 15.6 18 17.4 18C19.2 18 19.2 15 21 15" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
        <Path d="M5.2 9.3C6.8 6.3 9.8 4.2 13.3 4.2C16.1 4.2 18.3 5.6 19.8 7.8" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      </BaseSvg>
    );
  }

  if (type === 'drought') {
    return (
      <BaseSvg size={size} color={color}>
        <Circle cx="17.5" cy="6.2" r="2.2" stroke={color} strokeWidth={1.8} />
        <Path d="M4 15.4H20M5.2 19.2H18.8" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
        <Path d="M7.4 15.4L8.7 13.1L10.1 14.2L11.4 11.6L12.8 13.2L14.4 10.8L15.7 12.3" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      </BaseSvg>
    );
  }

  if (type === 'volcano' || type === 'volcanic_cloud') {
    return (
      <BaseSvg size={size} color={color}>
        <Path d="M4.2 19.2L9.1 9.6H14.9L19.8 19.2H4.2Z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
        <Path d="M9.9 9.6L11.4 12.4H12.7L14.1 9.6" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
        <Path d="M11.7 7.9C10.7 7 10.7 5.6 11.8 4.8C12.9 4 12.9 2.8 11.9 2" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
        <Path d="M14.1 8.1C15 7.2 15 5.8 13.9 5.1C12.8 4.3 12.8 3 13.7 2.2" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      </BaseSvg>
    );
  }

  if (type === 'sandstorm' || type === 'dust_devils' || type === 'downdraft') {
    return (
      <BaseSvg size={size} color={color}>
        <Path d="M3.5 9.2C5.2 8.1 7.2 8.1 8.9 9.2C10.6 10.3 12.6 10.3 14.3 9.2C16 8.1 18 8.1 19.7 9.2" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
        <Path d="M4.2 12.8C5.7 11.9 7.3 11.9 8.8 12.8C10.3 13.7 11.9 13.7 13.4 12.8C14.9 11.9 16.5 11.9 18 12.8" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
        <Path d="M6 16.2C7.1 15.5 8.2 15.5 9.3 16.2C10.4 16.9 11.5 16.9 12.6 16.2" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
        <Circle cx="16.5" cy="16.2" r="1" fill={color} />
        <Circle cx="18.5" cy="17.1" r="0.9" fill={color} />
      </BaseSvg>
    );
  }

  return null;
};

export const HazardSymbolIcon: React.FC<Props> = ({
  eventType,
  fallbackIcon = 'alert-circle-outline',
  size = 24,
  color = '#FFFFFF',
}) => {
  const normalizedType = String(eventType || '').trim().toLowerCase();
  const customIcon = renderCustomHazard(normalizedType, size, color);
  if (customIcon) return customIcon;
  return <Icon name={fallbackIcon} size={size} color={color} />;
};

export default HazardSymbolIcon;
