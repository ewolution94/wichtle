<!--
  The reveal: the Advent door with the party's date on it, in a paper-cut house front. A tap opens it
  (the page asks the server first; the name is never in the page before), and behind it, in the lit
  room, the name of the person drawn.
-->
<script lang="ts">
  let {
    n,
    open,
    name,
    to,
    hint,
    label,
    busy = false,
    onopen,
  }: { n: number; open: boolean; name: string; to: string; hint: string; label: string; busy?: boolean; onopen: () => void } = $props();
</script>

<button type="button" class="plain rv" class:open class:busy disabled={open} aria-label={open ? `${to} ${name}` : label} onclick={onopen}>
  <span class="facade" aria-hidden="true">
    <span class="gable"></span>
    <span class="fbody">
      <span class="fwins"><i class="win lit"></i><i class="win lit"></i></span>
      <span class="doorway">
        <span class="room"><span class="to">{to}</span><b style="--len:{[...name].length}">{name}</b></span>
        <span class="door"><b>{n}</b><i class="knob"></i></span>
      </span>
    </span>
    <span class="stoop"></span>
  </span>
  {#if !open}<span class="rv-hint">{hint}</span>{/if}
</button>

<style>
  .rv {
    display: grid;
    justify-items: center;
    gap: 12px;
    width: 100%;
  }

  .rv[disabled] {
    cursor: default;
  }

  .facade {
    position: relative;
    width: 270px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .gable {
    width: 230px;
    height: 70px;
    background: var(--m-cut);
    clip-path: polygon(0 100%, 0 72%, 13% 72%, 13% 46%, 27% 46%, 27% 22%, 40% 22%, 40% 0, 60% 0, 60% 22%, 73% 22%, 73% 46%, 87% 46%, 87% 72%, 100% 72%, 100% 100%);
  }

  .fbody {
    position: relative;
    width: 230px;
    height: 236px;
    background: var(--m-cut);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 16px;
    gap: 14px;
  }

  .fwins {
    display: flex;
    gap: 34px;
  }

  .win {
    position: relative;
    width: 26px;
    height: 30px;
    border-radius: 13px 13px 0 0;
    background: var(--m-glow);
    box-shadow: 0 0 14px 4px var(--m-glow-sh);
  }

  .win::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--m-cut);
  }

  .win::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 15px;
    height: 2px;
    background: var(--m-cut);
  }

  .doorway {
    position: relative;
    width: 150px;
    height: 164px;
    border-radius: 75px 75px 0 0;
    background: var(--m-win);
  }

  .room {
    position: absolute;
    inset: 0;
    border-radius: 75px 75px 0 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 2px;
    padding: 18px 10px 0;
    text-align: center;
    background: radial-gradient(circle at 50% 60%, light-dark(#fff3cf, #ffe2a1), var(--m-glow) 70%);
    color: #1b1407;
    box-shadow: 0 0 30px 6px var(--m-glow-sh);
  }

  .room .to {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-weight: 700;
  }

  .room b {
    font: 700 clamp(26px, calc(300px / max(6, var(--len, 6))), 46px) / 1 var(--m-disp);
    overflow-wrap: anywhere;
    max-width: 130px;
  }

  .door {
    position: absolute;
    inset: 0;
    border-radius: 75px 75px 0 0;
    background: var(--m-door);
    border: 3px solid var(--m-cut);
    box-shadow:
      inset 0 0 0 5px var(--m-door),
      inset 0 0 0 7px var(--m-door-ring);
    display: grid;
    place-items: center;
    transform-origin: 0 50%;
    transition: transform 1s var(--ewo-ease, cubic-bezier(0.2, 0.7, 0.2, 1));
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
  }

  .door b {
    font: 700 78px/1 var(--m-disp);
    color: var(--m-door-ink);
    margin-top: 18px;
    transition: opacity 0.15s 0.3s;
  }

  .knob {
    position: absolute;
    right: 18px;
    top: 96px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--m-cut);
    transition: opacity 0.15s 0.3s;
  }

  .open .door {
    transform: perspective(700px) rotateY(-112deg);
  }

  .open .door b,
  .open .knob {
    opacity: 0;
  }

  .busy .door {
    animation: knock 0.5s ease-in-out infinite alternate;
  }

  @keyframes knock {
    to {
      transform: perspective(700px) rotateY(-8deg);
    }
  }

  .stoop {
    width: 270px;
    height: 12px;
    background: var(--m-cut);
  }

  .rv-hint {
    font-size: 15px;
    font-weight: 700;
    color: var(--m-accent);
  }

  @media (hover: hover) {
    .rv:not([disabled]):hover .door {
      transform: perspective(700px) rotateY(-10deg);
    }
  }
</style>
