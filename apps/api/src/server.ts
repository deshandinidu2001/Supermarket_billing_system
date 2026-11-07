import { app } from './app';
const port = Number(process.env.PORT || 4311);
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => {
  const address = server.address();
  console.log(
    `Owner analytics listening on port ${address && typeof address === 'object' ? address.port : port}`,
  );
});
