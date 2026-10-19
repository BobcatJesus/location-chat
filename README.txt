SIDE QUEST — BARTENDER v7.2: TIMING + A BIGGER BEER

Two refinements on v7.1 (he tested it: mostly worked):

1. "Here you go" no longer talks over the drink. The bubble was
   still landing on the mug because the bartender stands a
   counter-depth above you — raising it was not enough. Now the
   line is DELAYED: it appears at +2.3s, as the mug comes down,
   and stays 1.6s. The pour and the sips play on a clear stage;
   he still says it, every time.
2. The beer mug is bigger: 15px -> 22px, so the raise / tip /
   sips actually read at a glance.

Cumulative with v7/v7.1. Extract over the repo root and push.
