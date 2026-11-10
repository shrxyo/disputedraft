import Link from "next/link";

// Placeholder: the AI analysis + draft view gets built here next.
export default async function DisputePage({ params }) {
  const { id } = await params;
  return (
    <main>
      <Link href="/">← Back to inbox</Link>
      <h1>{id}</h1>
      <p>Dispute details and AI draft coming next.</p>
    </main>
  );
}
