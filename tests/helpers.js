export function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, url: `http://localhost:${server.address().port}` }));
  });
}
export function close(...servers) {
  for (const s of servers) { s.closeAllConnections(); s.close(); }
}
