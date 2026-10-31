/**
 * OpenRator — in-app icon set (M6.6). Paths mirror brand/svg/icons/*.svg so the
 * tab bar, settings, and empty states share the same geometry as the brand kit.
 */

import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

export type IconName =
  | 'home'
  | 'spend'
  | 'providers'
  | 'keys'
  | 'settings'
  | 'bell'
  | 'chevron-right'
  | 'external'
  | 'plus'
  | 'alert';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 24, color = '#0A74D8', strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityRole="image"
      accessibilityLabel={name}
    >
      {name === 'home' ? (
        <Path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6.5H9V21H4a1 1 0 0 1-1-1z" />
      ) : null}
      {name === 'spend' ? (
        <>
          <Path d="M3 21h18" />
          <Path d="M6 21V11" />
          <Path d="M11 21V5" />
          <Path d="M16 21v-7" />
          <Path d="M21 21V8" />
        </>
      ) : null}
      {name === 'providers' ? (
        <>
          <Circle cx={12} cy={12} r={9} />
          <Path d="M3 12h18" />
          <Path d="M12 3c2.6 2.4 4 5.5 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.5-4-9s1.4-6.6 4-9z" />
        </>
      ) : null}
      {name === 'keys' ? (
        <>
          <Circle cx={8} cy={15} r={4} />
          <Path d="M11 12 20 3" />
          <Path d="M16 7l3 3" />
          <Path d="M18 5l2 2" />
        </>
      ) : null}
      {name === 'settings' ? (
        <>
          <Path d="M4 6h16" />
          <Path d="M4 12h16" />
          <Path d="M4 18h16" />
          <Circle cx={9} cy={6} r={2} fill={color} stroke="none" />
          <Circle cx={15} cy={12} r={2} fill={color} stroke="none" />
          <Circle cx={8} cy={18} r={2} fill={color} stroke="none" />
        </>
      ) : null}
      {name === 'bell' ? (
        <>
          <Path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
          <Path d="M10 20a2.4 2.4 0 0 0 4 0" />
        </>
      ) : null}
      {name === 'chevron-right' ? <Path d="M9 5l7 7-7 7" /> : null}
      {name === 'external' ? (
        <>
          <Path d="M14 4h6v6" />
          <Path d="M20 4 11 13" />
          <Path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
        </>
      ) : null}
      {name === 'plus' ? (
        <>
          <Path d="M12 5v14" />
          <Path d="M5 12h14" />
        </>
      ) : null}
      {name === 'alert' ? (
        <>
          <Path d="M12 3 2.8 20h18.4z" />
          <Path d="M12 9v5" />
          <Path d="M12 17.5h.01" />
        </>
      ) : null}
    </Svg>
  );
}
