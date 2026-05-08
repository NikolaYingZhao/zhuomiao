<script lang="ts">
  import type { PetState } from '$lib/types';

  let { state = 'idle' }: { state: PetState } = $props();
</script>

<div class="pet" class:happy={state === 'happy'} class:angry={state === 'angry'} class:worried={state === 'worried'} class:sleeping={state === 'sleeping'} class:eating={state === 'eating'} class:playing={state === 'playing'}>
  <div class="cat">
    <div class="ear ear-left"></div>
    <div class="ear ear-right"></div>
    <div class="head">
      <div class="eye eye-left">
        <div class="pupil"></div>
      </div>
      <div class="eye eye-right">
        <div class="pupil"></div>
      </div>
      <div class="nose"></div>
      <div class="mouth"></div>
      <div class="blush blush-left"></div>
      <div class="blush blush-right"></div>
    </div>
    <div class="body">
      <div class="paw paw-left"></div>
      <div class="paw paw-right"></div>
      <div class="tail"></div>
    </div>
    <div class="zzz">💤</div>
    <div class="anger-mark">💢</div>
  </div>
</div>

<style>
  .pet {
    width: 200px;
    height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
    user-select: none;
  }

  .cat {
    position: relative;
    animation: bob 2s ease-in-out infinite;
  }

  .happy .cat { animation: bounce 0.5s ease-in-out infinite; }
  .angry .cat { animation: shake 0.3s ease-in-out infinite; }
  .worried .cat { animation: wobble 1s ease-in-out infinite; }
  .sleeping .cat { animation: breathe 3s ease-in-out infinite; }
  .eating .cat { animation: nom 0.4s ease-in-out infinite; }
  .playing .cat { animation: spin 1s linear infinite; }

  .zzz, .anger-mark { display: none; }
  .sleeping .zzz { display: block; position: absolute; top: -20px; right: -10px; font-size: 20px; animation: float 2s ease-in-out infinite; }
  .angry .anger-mark { display: block; position: absolute; top: -15px; right: -10px; font-size: 18px; }
  .sleeping .eye .pupil { display: none; }
  .sleeping .eye { height: 2px; border-radius: 2px; top: 32px; }

  .head {
    width: 80px;
    height: 65px;
    background: #ff9f43;
    border-radius: 50% 50% 45% 45%;
    position: relative;
    z-index: 2;
  }

  .ear {
    position: absolute;
    width: 0;
    height: 0;
    border-left: 14px solid transparent;
    border-right: 14px solid transparent;
    border-bottom: 22px solid #ff9f43;
    z-index: 1;
    top: -16px;
  }
  .ear-left { left: 10px; transform: rotate(-10deg); }
  .ear-right { right: 10px; transform: rotate(10deg); }

  .ear-left::after, .ear-right::after {
    content: '';
    position: absolute;
    width: 0;
    height: 0;
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
    border-bottom: 14px solid #ffb97b;
    top: 6px;
    left: -8px;
  }

  .eye {
    position: absolute;
    width: 14px;
    height: 14px;
    background: #333;
    border-radius: 50%;
    top: 24px;
  }
  .eye-left { left: 16px; }
  .eye-right { right: 16px; }

  .pupil {
    position: absolute;
    width: 6px;
    height: 6px;
    background: white;
    border-radius: 50%;
    top: 3px;
    right: 2px;
  }

  .happy .eye { height: 6px; border-radius: 6px 6px 0 0; top: 28px; }
  .happy .pupil { display: none; }
  .happy .blush { opacity: 1; }

  .angry .eye-left { transform: rotate(-10deg); }
  .angry .eye-right { transform: rotate(10deg); }

  .nose {
    position: absolute;
    width: 6px;
    height: 4px;
    background: #e17055;
    border-radius: 50%;
    top: 35px;
    left: 50%;
    transform: translateX(-50%);
  }

  .mouth {
    position: absolute;
    width: 12px;
    height: 6px;
    border-bottom: 2px solid #e17055;
    border-radius: 0 0 50% 50%;
    top: 38px;
    left: 50%;
    transform: translateX(-50%);
  }

  .happy .mouth {
    width: 16px;
    height: 10px;
    border-bottom: 3px solid #e17055;
    top: 36px;
  }

  .blush {
    position: absolute;
    width: 10px;
    height: 6px;
    background: rgba(255, 107, 107, 0.3);
    border-radius: 50%;
    top: 32px;
    opacity: 0;
    transition: opacity 0.3s;
  }
  .blush-left { left: 6px; }
  .blush-right { right: 6px; }

  .body {
    width: 70px;
    height: 50px;
    background: #ff9f43;
    border-radius: 50% 50% 40% 40%;
    margin: -4px auto 0;
    position: relative;
    z-index: 1;
  }

  .paw {
    position: absolute;
    width: 16px;
    height: 10px;
    background: #ffb97b;
    border-radius: 50%;
    bottom: -4px;
  }
  .paw-left { left: 10px; }
  .paw-right { right: 10px; }

  .tail {
    position: absolute;
    width: 30px;
    height: 30px;
    border: 3px solid transparent;
    border-right: 3px solid #ff9f43;
    border-radius: 50%;
    right: -20px;
    top: -10px;
    animation: wag 1s ease-in-out infinite;
  }

  @keyframes bob {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-5px); }
  }
  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-15px); }
  }
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-5px); }
    75% { transform: translateX(5px); }
  }
  @keyframes wobble {
    0%, 100% { transform: rotate(0deg); }
    25% { transform: rotate(-3deg); }
    75% { transform: rotate(3deg); }
  }
  @keyframes breathe {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
  }
  @keyframes nom {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-3px); }
  }
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  @keyframes wag {
    0%, 100% { transform: rotate(-20deg); }
    50% { transform: rotate(20deg); }
  }
  @keyframes float {
    0%, 100% { transform: translateY(0); opacity: 1; }
    50% { transform: translateY(-8px); opacity: 0.6; }
  }
</style>
