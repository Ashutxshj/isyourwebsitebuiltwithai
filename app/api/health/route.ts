export function GET() {
  return Response.json({ ok: true, node: process.version });
}
