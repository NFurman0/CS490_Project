import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfigErrorScreen } from './ConfigErrorScreen';

describe('ConfigErrorScreen', () => {
  it('lists each configuration problem so the developer knows what to fix', () => {
    render(<ConfigErrorScreen problems={['VITE_API_BASE_URL is missing']} />);
    expect(screen.getByRole('alert')).toHaveTextContent('VITE_API_BASE_URL is missing');
  });
});
