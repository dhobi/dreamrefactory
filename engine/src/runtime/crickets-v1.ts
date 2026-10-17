import { CricketsV4 } from "./crickets-v4";

/**
 * DF.EXE's (Dust): its pass has the bouncing balls where the others have
 * crickets (0x438870), and its save keeps them in the crickets' container. The
 * cricket builtins are TI.EXE's (CricketsV4), which Dust's scripts do not call.
 */
export class CricketsV1 extends CricketsV4 {
  override readonly engine = 1;

  override pass(): boolean {
    this.session.balls.step();
    return true;
  }
}
