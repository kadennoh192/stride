const headers = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

export function GET() {
  return Response.json(
    { epochMs: Date.now(), source: 'stride-edge' },
    { headers },
  );
}
