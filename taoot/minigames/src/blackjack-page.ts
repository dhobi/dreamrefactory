/**
 * Blackjack at Buick's table, on its own.
 *
 * `BLKJACK.STG`'s `openstage ()` opens its track and its shop and stops there:
 * on the ship the GAME is started by the dealer's conversation
 * (`BLKJACK1.PUP/0005 runyoself`), which asks whether you have met before — and
 * whose answer sets `playingcards`, the deck the cards are dealt from. Its last
 * two statements are the ones that matter here:
 *
 *     playcards = true
 *     buickphase = 1
 *     firsthand = true
 *
 * `initgame ()` is called from nowhere on the disc, and `newgame ()` reads
 * `firsthand` before anything writes it — so a stage opened cold deals from an
 * unset flag. Seeding it and calling `initgame` is the whole shim.
 *
 * ## The deck is a choice, and it is the game's own
 *
 * `BLKJACK.STG/0002` asks `if playingcards = "dust"` twice when it lays the
 * cards out: answer the dealer "yes, we met at the Hard Drive Saloon" on the
 * ship and you play the rest of the hand with DUST's card backs — a cross-game
 * wink already on the disc, and one almost nobody will have seen, because it is
 * behind a reply to a question about a saloon in another game. Standalone there
 * is no conversation to answer, so it is a query parameter: `?deck=dust`.
 */
import { bootMinigame, markOption } from "./minigame-boot";

/** which backs the cards carry — the dealer's question, asked in the URL instead */
function deck(): string {
  return new URLSearchParams(window.location.search).get("deck") === "dust"
    ? "dust"
    : "titanic";
}

markOption(deck() === "dust" ? "?deck=dust" : "");

void bootMinigame({
  stage: "blkjack.stg",
  title: "minigames.blackjack",
  start: async (host) => {
    const g = host.session.interp.globals;
    /**
     * THE DEALER HIMSELF, because the rematch is his line.
     *
     * When a hand is settled the table asks him, not us: `BLKJACK.STG/0002` ends
     * `puppetvisible (true); puppetgrab (false); visualeffect (wipeleft, 20);
     * return sendtopuppetfx ("boot script", playagain ())`, and his `playagain`
     * reacts to who won (`playerwin ()`, `buickwin ()`, `draw ()`) before
     * offering "Yes, I'll play another hand." / "No, I've got to go now.".
     *
     * With no puppet loaded that dispatch finds nobody, `playagain ()` answers
     * nothing, and `newgame ()` takes its `if not playagain ()` branch straight to
     * `closecards ()` — one hand and the table shuts. So he is opened before the
     * first deal, which is also where the ship has him: his conversation is what
     * gets you to the table in the first place.
     *
     * Not `runyoself` though — that is the "have we met?" conversation, and it is
     * the one thing here the ship does that this page deliberately does not.
     */
    await host.session.puppetCtrl.openPuppetFile("blkjack1.pup");
    g.set("playingcards", deck());
    // the two the dealer's conversation would have left behind
    g.set("firsthand", 1);
    g.set("buickphase", 1);
    /*
     * `initgame` is the FLAT's, not the stage main's.
     *
     * `BLKJACK.STG` container 1 carries `openstage`/`closestage`/`shuffle` and
     * container 2 — the flat `blkjack`'s own script — carries the game:
     * `initgame`, `newgame`, `dealcards`, `hitplayer`, `checktotals`. Fired at
     * `stageScript` it lands on a script that has never heard of it, which is a
     * boot that opens the table and deals nothing (globals `{firsthand: 1}` and
     * not one card).
     */
    const flat = host.session.flatScripts.get(host.session.currentFlat.toLowerCase());
    await host.session.fireHandler(flat, "initgame", host.session.currentFlat);
  },
});
