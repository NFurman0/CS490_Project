import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <>
      <h1>Page not found</h1>
      <p>Oof! Wrong turn in the obby. Check the address, or head back home.</p>
      <p>
        <Link to="/">Go to ReviewLens home</Link>
      </p>
    </>
  );
}
