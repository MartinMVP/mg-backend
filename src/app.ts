import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { env } from './config/env';
import healthRouter from './http/routes/health';
import authRouter from './http/routes/auth';

const app = express();

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));

app.use('/health', healthRouter);
app.use('/auth', authRouter);

export default app;
