import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the application shell', () => {
    render(<App />);
    expect(screen.getByRole('banner')).toHaveTextContent('ReviewLens');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Review analysis workspace',
    );
  });
});
