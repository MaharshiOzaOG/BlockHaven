import { env } from 'cloudflare:workers';
import { gameGateway } from '../../../server/gateway';
export const dynamic = 'force-dynamic';
export async function POST(req:Request) { return (await gameGateway(req,env))!; }
