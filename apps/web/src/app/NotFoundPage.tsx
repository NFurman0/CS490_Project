import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <>
      <h1>Page not found</h1>
      <p>This page doesn’t exist. Check the address, or go back to the start.</p>
      <p>
        <Link to="/">Go to ReviewLens home</Link>
      </p>
    </>
  );
}
