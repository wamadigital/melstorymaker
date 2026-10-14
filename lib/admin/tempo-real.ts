/**
 * Quadro ao vivo (pedido do owner em 14/10/2026): o banco avisa, por um canal
 * PRIVADO do Supabase Realtime, que algum lead mudou, e o quadro aberto se
 * redesenha sozinho. O aviso nao leva dado nenhum -- quem le os leads continua
 * sendo o servidor, pela service role (ver supabase/quadro-tempo-real.sql).
 *
 * Topico e evento estao tambem no trigger do banco; `tempo-real.test.ts`
 * confere que os dois lados dizem a mesma coisa.
 */
export const TOPICO_QUADRO = "quadro-leads";
export const EVENTO_QUADRO = "mudou";

/**
 * Janela que junta avisos num refresh so. Um lead nascendo grava duas vezes
 * seguidas (a linha e o rastreio), e o esfriar move varios de uma vez: sem a
 * janela, cada aviso seria um render inteiro do quadro, com as seis consultas.
 */
export const JANELA_AVISO_MS = 1000;

/**
 * Aba escondida por mais que isto volta com um refresh, haja aviso ou nao. O
 * canal nao reentrega o que passou enquanto o celular dormia, e o socket morto
 * pode levar ate o proximo heartbeat para perceber que caiu.
 */
export const AUSENCIA_MAX_MS = 60_000;
