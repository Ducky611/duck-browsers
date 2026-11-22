export function mountLocalGame(id, playArea) {
    const $ = (selector, root = playArea) => root.querySelector(selector);
    const safeGet = key => { try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; } };
    const safeSet = (key, value) => { try { localStorage.setItem(key, String(value)); } catch {} };
    let cleanupGame = () => {};
    function gameLayout(stage,side) {
      playArea.innerHTML='<div class="game-layout"><div class="game-stage" id="gameStage"></div><aside class="game-side" id="gameSide"></aside></div>';
      $('#gameStage').append(stage);$('#gameSide').append(side);
    }
    function sidePanel(instructions) {
      const side=document.createElement('div');
      side.innerHTML='<div class="mono muted">SCORE / PROGRESS</div><div class="game-score" id="score">0</div><div class="game-state" id="gameState">READY TO PLAY</div><p class="game-note"></p><div class="game-actions" id="gameActions"></div>';
      $('.game-note',side).textContent=instructions;return side;
    }
    function addAction(host,label,handler) {
      const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',handler);host.append(b);return b;
    }
    function directionFromKey(key) {
      return ({ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right'})[key];
    }
    function attachSwipes(el,handler){
      let start=null;
      el.addEventListener('touchstart',e=>{if(e.touches.length===1)start=[e.touches[0].clientX,e.touches[0].clientY];},{passive:true});
      el.addEventListener('touchend',e=>{if(!start)return;const dx=e.changedTouches[0].clientX-start[0],dy=e.changedTouches[0].clientY-start[1];start=null;if(Math.max(Math.abs(dx),Math.abs(dy))<25)return;handler(Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up');},{passive:true});
    }
    function addDpad(side,handler){
      const pad=document.createElement('div');pad.className='dpad';
      [['up','↑'],['left','←'],['down','↓'],['right','→']].forEach(([dir,char])=>{
        const b=document.createElement('button');b.type='button';b.className=dir;b.textContent=char;b.setAttribute('aria-label','Move '+dir);
        b.addEventListener('click',()=>handler(dir));pad.append(b);
      });side.append(pad);
    }

    // Snake: real canvas gameplay, score, collision, restart, pause, touch controls.
    function initSnake(){
      const canvas=document.createElement('canvas');canvas.width=420;canvas.height=420;canvas.id='snakeCanvas';
      const side=sidePanel('Arrow keys or WASD to move. On phones, use the arrows or swipe the board.');
      gameLayout(canvas,side);
      const ctx=canvas.getContext('2d'), N=21, unit=20;
      let snake=[{x:10,y:10},{x:9,y:10},{x:8,y:10}],dir='right',next='right',food=null,score=0,paused=false,dead=false;
      const vectors={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}, opposites={up:'down',down:'up',left:'right',right:'left'};
      function putFood(){const open=[];for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(!snake.some(s=>s.x===x&&s.y===y))open.push({x,y});food=open.length?open[Math.floor(Math.random()*open.length)]:null;}
      putFood();
      const pauseBtn=addAction($('#gameActions'),'PAUSE',()=>{if(dead)return;paused=!paused;pauseBtn.textContent=paused?'RESUME':'PAUSE';$('#gameState').textContent=paused?'PAUSED':'IN MOTION';});
      addDpad(side,changeDirection);
      function changeDirection(want){if(!dead&&want!==opposites[dir])next=want;}
      function onKey(e){const d=directionFromKey(e.key);if(d){e.preventDefault();changeDirection(d);}else if(e.code==='Space'){e.preventDefault();pauseBtn.click();}}
      window.addEventListener('keydown',onKey);
      attachSwipes(canvas,changeDirection);
      function tick(){
        if(paused||dead)return;dir=next;
        const [dx,dy]=vectors[dir],head={x:snake[0].x+dx,y:snake[0].y+dy};
        const eating=food&&head.x===food.x&&head.y===food.y;
        const body=eating?snake:snake.slice(0,-1);
        if(head.x<0||head.y<0||head.x>=N||head.y>=N||body.some(c=>c.x===head.x&&c.y===head.y)){
          dead=true;clearInterval(timer);$('#gameState').textContent='GAME OVER — PRESS ↻ TO RESTART';draw();return;
        }
        snake.unshift(head);
        if(eating){score+=10;$('#score').textContent=score;if(score>safeGet('sii_snake_best'))safeSet('sii_snake_best',score);putFood();if(!food){dead=true;clearInterval(timer);$('#gameState').textContent='PERFECT GAME!';}}
        else snake.pop();draw();
      }
      function draw(){
        ctx.fillStyle='#080808';ctx.fillRect(0,0,420,420);ctx.strokeStyle='#1a1a1a';ctx.lineWidth=1;
        for(let i=0;i<=N;i++){ctx.beginPath();ctx.moveTo(i*unit,0);ctx.lineTo(i*unit,420);ctx.stroke();ctx.beginPath();ctx.moveTo(0,i*unit);ctx.lineTo(420,i*unit);ctx.stroke();}
        if(food){ctx.fillStyle='#00ff00';ctx.fillRect(food.x*unit+3,food.y*unit+3,unit-6,unit-6);}
        snake.forEach((p,i)=>{ctx.fillStyle=i===0?'#00ff00':'#fff';ctx.fillRect(p.x*unit+2,p.y*unit+2,unit-4,unit-4);});
      }
      $('#gameState').textContent='BEST: '+safeGet('sii_snake_best')+' / GO!';draw();
      const timer=setInterval(tick,120);
      cleanupGame=()=>{clearInterval(timer);window.removeEventListener('keydown',onKey);};
    }

    // 2048: genuine merges in four directions, spawns, win/loss detection.
    function init2048(){
      const stage=document.createElement('div');stage.className='number-grid';stage.setAttribute('role','grid');stage.setAttribute('aria-label','2048 board');
      const side=sidePanel('Use arrow keys, WASD, or swipe. Equal numbers merge once per move.');gameLayout(stage,side);
      let cells=Array(16).fill(0),score=0,gameOver=false,notedWin=false;
      function spawn(){const free=cells.map((v,i)=>v===0?i:-1).filter(i=>i!==-1);if(!free.length)return;cells[free[Math.floor(Math.random()*free.length)]]=Math.random()<.9?2:4;}
      spawn();spawn();
      function render(){stage.innerHTML=cells.map(v=>`<div class="number-cell ${v?'filled':''}" data-value="${v}" role="gridcell" aria-label="${v||'empty'}">${v||''}</div>`).join('');$('#score').textContent=score;}
      function canMove(){if(cells.includes(0))return true;for(let i=0;i<16;i++){const r=i>>2,c=i%4;if(c<3&&cells[i]===cells[i+1])return true;if(r<3&&cells[i]===cells[i+4])return true;}return false;}
      function move(dir){
        if(gameOver)return;const old=cells.slice(),fresh=Array(16).fill(0);
        for(let k=0;k<4;k++){
          const positions=[];for(let j=0;j<4;j++)positions.push(dir==='left'?k*4+j:dir==='right'?k*4+3-j:dir==='up'?j*4+k:(3-j)*4+k);
          const vals=positions.map(i=>old[i]).filter(Boolean),merged=[];
          for(let j=0;j<vals.length;j++){if(j+1<vals.length&&vals[j]===vals[j+1]){const v=vals[j]*2;merged.push(v);score+=v;j++;}else merged.push(vals[j]);}
          positions.forEach((p,i)=>fresh[p]=merged[i]||0);
        }
        if(fresh.every((v,i)=>v===old[i]))return;cells=fresh;spawn();render();
        if(!notedWin&&cells.includes(2048)){notedWin=true;$('#gameState').textContent='2048 REACHED — KEEP GOING!';}
        else if(!canMove()){gameOver=true;$('#gameState').textContent='NO MORE MOVES — PRESS ↻';}
        else if(!notedWin)$('#gameState').textContent='COMBINE THE TILES';
      }
      function onKey(e){const d=directionFromKey(e.key);if(d){e.preventDefault();move(d);}}
      window.addEventListener('keydown',onKey);attachSwipes(stage,move);addDpad(side,move);render();$('#gameState').textContent='REACH 2048';
      cleanupGame=()=>window.removeEventListener('keydown',onKey);
    }

    // Minesweeper: generated after first click, safe first move, flood reveal, flagging.
    function initMines(){
      const grid=document.createElement('div');grid.className='mine-grid';grid.setAttribute('role','grid');grid.setAttribute('aria-label','Minesweeper board');
      const side=sidePanel('Left click to reveal. Right click to flag. On touchscreens, use FLAG MODE. Your first tap is safe.');gameLayout(grid,side);
      const N=9,total=10;let mines=new Set(),flags=new Set(),revealed=new Set(),begun=false,lost=false,won=false,flagMode=false,seconds=0;
      const flagButton=addAction($('#gameActions'),'FLAG MODE: OFF',()=>{flagMode=!flagMode;flagButton.textContent='FLAG MODE: '+(flagMode?'ON':'OFF');flagButton.classList.toggle('selected',flagMode);});
      const neighbors=i=>{const x=i%N,y=Math.floor(i/N),out=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if((dx||dy)&&nx>=0&&nx<N&&ny>=0&&ny<N)out.push(ny*N+nx);}return out;};
      function setup(first){const excluded=new Set([first,...neighbors(first)]),options=Array.from({length:N*N},(_,i)=>i).filter(i=>!excluded.has(i));while(mines.size<total){const idx=Math.floor(Math.random()*options.length);mines.add(options.splice(idx,1)[0]);}}
      function update(){
        grid.innerHTML='';for(let i=0;i<N*N;i++){
          const b=document.createElement('button');b.type='button';b.className='mine-cell';b.dataset.cell=String(i);
          const visible=revealed.has(i)||lost&&mines.has(i);
          if(visible){b.classList.add('revealed');if(mines.has(i)){b.classList.add('bomb');b.textContent='✳';b.setAttribute('aria-label','Mine');}else{const n=neighbors(i).filter(j=>mines.has(j)).length;if(n){b.textContent=n;b.dataset.n=n;}b.setAttribute('aria-label',n?n+' nearby mines':'Clear');}}
          else if(flags.has(i)){b.classList.add('flag');b.textContent='⚑';b.setAttribute('aria-label','Flagged cell');}
          else b.setAttribute('aria-label','Hidden cell');
          grid.append(b);
        }
        $('#score').textContent=`${total-flags.size}`;if(!lost&&!won)$('#gameState').textContent=`FLAGS LEFT / ${seconds}S`;
      }
      function toggleFlag(i){if(lost||won||revealed.has(i))return;if(flags.has(i))flags.delete(i);else if(flags.size<total)flags.add(i);update();}
      function reveal(i){
        if(lost||won||flags.has(i)||revealed.has(i))return;
        if(!begun){setup(i);begun=true;}
        if(mines.has(i)){lost=true;$('#gameState').textContent='BOOM — PRESS ↻ TO RESTART';update();return;}
        const queue=[i];while(queue.length){const current=queue.pop();if(revealed.has(current)||flags.has(current))continue;revealed.add(current);if(neighbors(current).filter(j=>mines.has(j)).length===0)neighbors(current).forEach(j=>{if(!mines.has(j)&&!revealed.has(j))queue.push(j);});}
        if(revealed.size===N*N-total){won=true;$('#gameState').textContent=`CLEARED IN ${seconds}S — YOU WIN!`;}update();
      }
      grid.addEventListener('click',e=>{const b=e.target.closest('[data-cell]');if(!b)return;const i=Number(b.dataset.cell);flagMode?toggleFlag(i):reveal(i);});
      grid.addEventListener('contextmenu',e=>{const b=e.target.closest('[data-cell]');if(!b)return;e.preventDefault();toggleFlag(Number(b.dataset.cell));});
      const timer=setInterval(()=>{if(begun&&!lost&&!won){seconds++;update();}},1000);update();
      cleanupGame=()=>clearInterval(timer);
    }

    // Memory: randomized pairs, match resolution, moves and completion state.
    function initMemory(){
      const stage=document.createElement('div');stage.className='memory-grid';stage.setAttribute('role','grid');stage.setAttribute('aria-label','Memory card board');
      const side=sidePanel('Flip any two cards. Match all eight pairs in as few moves as possible.');gameLayout(stage,side);
      const values=['◆','✳','◈','◉','⬡','✦','▣','△'];
      const deck=[...values,...values];for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
      let flipped=[],matched=new Set(),moves=0,locked=false,timeout=null;
      function render(){
        stage.innerHTML='';deck.forEach((symbol,i)=>{
          const b=document.createElement('button');b.type='button';b.dataset.card=i;
          const show=matched.has(i)||flipped.includes(i);
          b.className='memory-card'+(matched.has(i)?' matched':show?' flipped':'');
          b.textContent=show?symbol:'?';b.setAttribute('aria-label',show?'Card '+symbol:'Hidden card');stage.append(b);
        });
        $('#score').textContent=moves;$('#gameState').textContent=matched.size===16?'ALL EIGHT PAIRS FOUND — YOU WIN!':`${matched.size/2} / 8 PAIRS MATCHED`;
      }
      stage.addEventListener('click',e=>{
        const b=e.target.closest('[data-card]');if(!b||locked)return;const i=Number(b.dataset.card);if(matched.has(i)||flipped.includes(i))return;
        flipped.push(i);if(flipped.length===2){moves++;if(deck[flipped[0]]===deck[flipped[1]]){flipped.forEach(x=>matched.add(x));flipped=[];}else{locked=true;timeout=setTimeout(()=>{flipped=[];locked=false;render();timeout=null;},760);}}
        render();
      });render();cleanupGame=()=>{if(timeout!==null)clearTimeout(timeout);};
    }


    // Shared arcade stage. All games here are implemented locally — no iframe dependency.
    function arcadeStage(instructions,width,height){
      const canvas=document.createElement('canvas'); canvas.width=width;canvas.height=height;canvas.className='arcade-canvas';
      canvas.setAttribute('aria-label','Playable arcade game canvas');
      const side=sidePanel(instructions);gameLayout(canvas,side);
      return {canvas,ctx:canvas.getContext('2d'),side};
    }
    function arcadeButton(label,cb){return addAction($('#gameActions'),label,cb);}
    function holdButton(label,onDown,onUp=()=>{}){
      const btn=addAction($('#gameActions'),label,()=>{});let active=false;
      btn.addEventListener('pointerdown',e=>{e.preventDefault();active=true;btn.setPointerCapture?.(e.pointerId);onDown();});
      const stop=()=>{if(active){active=false;onUp();}};
      btn.addEventListener('pointerup',stop);btn.addEventListener('pointercancel',stop);btn.addEventListener('lostpointercapture',stop);
      return btn;
    }

    // TETROMINO DROP: seven pieces, hold-free classic line clearing, wall kicks and scoring.
    function initTetris(){
      const {canvas,ctx}=arcadeStage('A / D or ← / → move · ↑ rotate · ↓ soft drop · SPACE hard drop · P pause.',300,600);
      const W=10,H=20,S=30,shapes={I:[[1,1,1,1]],O:[[1,1],[1,1]],T:[[0,1,0],[1,1,1]],S:[[0,1,1],[1,1,0]],Z:[[1,1,0],[0,1,1]],J:[[1,0,0],[1,1,1]],L:[[0,0,1],[1,1,1]]};
      let board=Array.from({length:H},()=>Array(W).fill('')),bag=[],piece=null,score=0,lines=0,level=1,paused=false,ended=false,lastFall=performance.now();
      function nextType(){if(!bag.length)bag=Object.keys(shapes).sort(()=>Math.random()-.5);return bag.pop();}
      function collides(x,y,matrix){return matrix.some((row,ry)=>row.some((v,rx)=>v&&(x+rx<0||x+rx>=W||y+ry>=H||(y+ry>=0&&board[y+ry][x+rx]))));}
      function spawn(){const type=nextType(),matrix=shapes[type].map(row=>row.slice());piece={type,matrix,x:Math.floor((W-matrix[0].length)/2),y:0};if(collides(piece.x,piece.y,matrix)){ended=true;$('#gameState').textContent='STACK REACHED THE TOP — GAME OVER';}}
      function draw(){
        ctx.fillStyle='#080808';ctx.fillRect(0,0,300,600);ctx.strokeStyle='#292929';ctx.lineWidth=.7;
        for(let x=0;x<=W;x++){ctx.beginPath();ctx.moveTo(x*S,0);ctx.lineTo(x*S,600);ctx.stroke();}
        for(let y=0;y<=H;y++){ctx.beginPath();ctx.moveTo(0,y*S);ctx.lineTo(300,y*S);ctx.stroke();}
        function drawCell(x,y,type,ghost=false){if(y<0)return;ctx.fillStyle=ghost?'#333':type==='I'||type==='T'?'#00ff00':'#fff';ctx.fillRect(x*S+1,y*S+1,S-2,S-2);if(!ghost){ctx.fillStyle=type==='I'||type==='T'?'#006c00':'#777';ctx.fillRect(x*S+4,y*S+4,S-8,3);}}
        board.forEach((row,y)=>row.forEach((t,x)=>{if(t)drawCell(x,y,t);}));
        if(piece&&!ended){let gy=piece.y;while(!collides(piece.x,gy+1,piece.matrix))gy++;piece.matrix.forEach((row,ry)=>row.forEach((v,rx)=>{if(v)drawCell(piece.x+rx,gy+ry,piece.type,true);}));piece.matrix.forEach((row,ry)=>row.forEach((v,rx)=>{if(v)drawCell(piece.x+rx,piece.y+ry,piece.type);}));}
        if(paused||ended){ctx.fillStyle='#000d';ctx.fillRect(0,245,300,110);ctx.fillStyle='#fff';ctx.font='900 25px Inter,Arial';ctx.textAlign='center';ctx.fillText(ended?'GAME OVER':'PAUSED',150,310);}
      }
      function update(){ $('#score').textContent=score;if(!ended)$('#gameState').textContent=`LEVEL ${level} / ${lines} LINES / BEST ${safeGet('sii_tetris_best')}`;draw();}
      function lock(){
        piece.matrix.forEach((row,ry)=>row.forEach((v,rx)=>{if(v&&piece.y+ry>=0)board[piece.y+ry][piece.x+rx]=piece.type;}));
        let cleared=0;for(let y=H-1;y>=0;y--){if(board[y].every(Boolean)){board.splice(y,1);board.unshift(Array(W).fill(''));cleared++;y++;}}
        if(cleared){score+=[0,100,300,500,800][cleared]*level;lines+=cleared;level=1+Math.floor(lines/10);if(score>safeGet('sii_tetris_best'))safeSet('sii_tetris_best',score);}
        spawn();update();
      }
      function step(){if(paused||ended)return;if(!collides(piece.x,piece.y+1,piece.matrix))piece.y++;else lock();update();}
      function move(dx){if(paused||ended)return;if(!collides(piece.x+dx,piece.y,piece.matrix)){piece.x+=dx;draw();}}
      function rotate(){if(paused||ended)return;const old=piece.matrix,rotated=old[0].map((_,x)=>old.map(row=>row[x]).reverse());for(const kick of [0,-1,1,-2,2]){if(!collides(piece.x+kick,piece.y,rotated)){piece.matrix=rotated;piece.x+=kick;break;}}draw();}
      function hardDrop(){if(paused||ended)return;while(!collides(piece.x,piece.y+1,piece.matrix)){piece.y++;score+=2;}lock();update();}
      const pauseBtn=arcadeButton('PAUSE',()=>{if(ended)return;paused=!paused;pauseBtn.textContent=paused?'RESUME':'PAUSE';update();});
      arcadeButton('◀',()=>move(-1));arcadeButton('ROTATE ↻',rotate);arcadeButton('▶',()=>move(1));arcadeButton('▼',step);arcadeButton('HARD DROP',hardDrop);
      function onKey(e){if(e.ctrlKey||e.altKey||e.metaKey)return;const d=directionFromKey(e.key);if(d){e.preventDefault();if(d==='left')move(-1);if(d==='right')move(1);if(d==='up')rotate();if(d==='down')step();}else if(e.code==='Space'){e.preventDefault();hardDrop();}else if(e.key.toLowerCase()==='p'){e.preventDefault();pauseBtn.click();}}
      document.addEventListener('keydown',onKey);
      let startX=0,startY=0;canvas.addEventListener('touchstart',e=>{startX=e.touches[0].clientX;startY=e.touches[0].clientY;},{passive:true});
      canvas.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-startX,dy=e.changedTouches[0].clientY-startY;if(Math.abs(dx)>35&&Math.abs(dx)>Math.abs(dy))move(Math.sign(dx));else if(dy>35)step();else rotate();},{passive:true});
      spawn();update();const timer=setInterval(()=>{if(!paused&&!ended&&performance.now()-lastFall>Math.max(105,640-(level-1)*52)){step();lastFall=performance.now();}},36);
      cleanupGame=()=>{clearInterval(timer);document.removeEventListener('keydown',onKey);};
    }

    // BRICK BREAKER: arcade physics, scoring, paddle control, lives and victory state.
    function initBreakout(){
      const {canvas,ctx}=arcadeStage('Move the paddle with mouse, touch, ← / → or A / D. Tap or press SPACE to launch the ball.',480,420);
      const W=480,H=420,cols=9,rows=5,gap=5,brickW=43,brickH=16,offX=(W-(brickW+gap)*cols+gap)/2;
      let paddle=199,paddleW=82,ball={x:240,y:365,vx:150,vy:-260},lives=3,score=0,playing=false,dead=false,won=false,left=false,right=false,last=performance.now(),bricks=[];
      for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)bricks.push({x:offX+c*(brickW+gap),y:48+r*24,alive:true});
      function launchBall(){if(dead||won)return;playing=true;$('#gameState').textContent='BALL IN MOTION';}
      function setPaddle(clientX){const rect=canvas.getBoundingClientRect();paddle=Math.max(0,Math.min(W-paddleW,(clientX-rect.left)*W/rect.width-paddleW/2));}
      canvas.addEventListener('pointermove',e=>setPaddle(e.clientX));canvas.addEventListener('pointerdown',e=>{setPaddle(e.clientX);launchBall();});
      function onKey(e){if(e.ctrlKey||e.metaKey||e.altKey)return;const d=directionFromKey(e.key);if(d==='left'||d==='right'){e.preventDefault();if(d==='left')left=true;else right=true;}if(e.code==='Space'){e.preventDefault();launchBall();}}
      function keyUp(e){const d=directionFromKey(e.key);if(d==='left')left=false;if(d==='right')right=false;}
      window.addEventListener('keydown',onKey);window.addEventListener('keyup',keyUp);
      holdButton('◀',()=>left=true,()=>left=false);arcadeButton('LAUNCH',launchBall);holdButton('▶',()=>right=true,()=>right=false);
      function draw(){
        ctx.fillStyle='#090909';ctx.fillRect(0,0,W,H);ctx.fillStyle='#fff';ctx.font='600 11px Inter';ctx.fillText('BRICKS LEFT: '+bricks.filter(b=>b.alive).length,18,20);
        for(const b of bricks){if(!b.alive)continue;ctx.fillStyle=b.y<85?'#00ff00':'#f3f3f3';ctx.fillRect(b.x,b.y,brickW,brickH);}
        ctx.fillStyle='#fff';ctx.fillRect(paddle,H-35,paddleW,9);ctx.fillStyle='#00ff00';ctx.beginPath();ctx.arc(ball.x,ball.y,7,0,Math.PI*2);ctx.fill();
        if(!playing&&!dead&&!won){ctx.fillStyle='#fff';ctx.font='700 14px Inter';ctx.textAlign='center';ctx.fillText('PRESS SPACE / TAP TO LAUNCH',W/2,H/2+40);ctx.textAlign='start';}
        if(dead||won){ctx.fillStyle='#000d';ctx.fillRect(0,177,W,70);ctx.fillStyle='#fff';ctx.font='900 32px Inter';ctx.textAlign='center';ctx.fillText(won?'STAGE CLEARED':'GAME OVER',W/2,219);ctx.textAlign='left';}
      }
      let raf;
      function frame(now){const dt=Math.min((now-last)/1000,.035);last=now;
        if(left)paddle=Math.max(0,paddle-360*dt);if(right)paddle=Math.min(W-paddleW,paddle+360*dt);
        if(!playing){if(!dead&&!won){ball.x=paddle+paddleW/2;ball.y=H-48;}}
        else{
          const prevY=ball.y;ball.x+=ball.vx*dt;ball.y+=ball.vy*dt;
          if(ball.x<7){ball.x=7;ball.vx=Math.abs(ball.vx);}if(ball.x>W-7){ball.x=W-7;ball.vx=-Math.abs(ball.vx);}if(ball.y<7){ball.y=7;ball.vy=Math.abs(ball.vy);}
          if(ball.vy>0&&prevY+7<=H-35&&ball.y+7>=H-35&&ball.x>=paddle-7&&ball.x<=paddle+paddleW+7){ball.y=H-42;ball.vy=-Math.abs(ball.vy);ball.vx=(ball.x-(paddle+paddleW/2))/(paddleW/2)*250;}
          for(const b of bricks){if(!b.alive)continue;if(ball.x+7>b.x&&ball.x-7<b.x+brickW&&ball.y+7>b.y&&ball.y-7<b.y+brickH){b.alive=false;ball.vy*=-1;score+=10;$('#score').textContent=score;break;}}
          if(!bricks.some(b=>b.alive)){playing=false;won=true;$('#gameState').textContent='ALL BRICKS DESTROYED — VICTORY';}
          if(ball.y>H+7){playing=false;lives--;$('#gameState').textContent=lives?'BALL LOST — LAUNCH AGAIN':'NO LIVES LEFT';if(!lives)dead=true;}
        }
        draw();raf=requestAnimationFrame(frame);
      }
      $('#score').textContent=score;$('#gameState').textContent='3 LIVES / READY';raf=requestAnimationFrame(frame);
      cleanupGame=()=>{cancelAnimationFrame(raf);window.removeEventListener('keydown',onKey);window.removeEventListener('keyup',keyUp);};
    }

    // PONG: a real single-player match against a computer opponent.
    function initPong(){
      const {canvas,ctx}=arcadeStage('First to 5 wins. Move with mouse, touch, W / S or ↑ / ↓. Right paddle is computer controlled.',500,340);
      const W=500,H=340,ph=68,pw=9;let playerY=136,aiY=136,p1=0,p2=0,up=false,down=false,ended=false,last=performance.now(),ball;
      function resetBall(direction){ball={x:250,y:170,vx:260*direction,vy:(Math.random()-.5)*190};}
      function mouse(e){const r=canvas.getBoundingClientRect();playerY=Math.max(0,Math.min(H-ph,(e.clientY-r.top)*H/r.height-ph/2));}
      canvas.addEventListener('pointermove',mouse);canvas.addEventListener('pointerdown',mouse);
      function onKey(e){const d=directionFromKey(e.key);if(d==='up'||d==='down'){e.preventDefault();if(d==='up')up=true;else down=true;}}
      function keyUp(e){const d=directionFromKey(e.key);if(d==='up')up=false;if(d==='down')down=false;}
      window.addEventListener('keydown',onKey);window.addEventListener('keyup',keyUp);
      holdButton('▲ UP',()=>up=true,()=>up=false);holdButton('▼ DOWN',()=>down=true,()=>down=false);
      function draw(){ctx.fillStyle='#080808';ctx.fillRect(0,0,W,H);ctx.setLineDash([9,10]);ctx.strokeStyle='#4d4d4d';ctx.beginPath();ctx.moveTo(W/2,0);ctx.lineTo(W/2,H);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#fff';ctx.fillRect(20,playerY,pw,ph);ctx.fillRect(W-29,aiY,pw,ph);ctx.fillStyle='#00ff00';ctx.fillRect(ball.x-6,ball.y-6,12,12);if(ended){ctx.fillStyle='#000c';ctx.fillRect(0,130,W,85);ctx.fillStyle='#fff';ctx.font='900 32px Inter';ctx.textAlign='center';ctx.fillText(p1===5?'YOU WIN!':'CPU WINS',W/2,180);ctx.textAlign='left';}}
      let raf;function frame(now){const dt=Math.min((now-last)/1000,.035);last=now;
        if(!ended){if(up)playerY=Math.max(0,playerY-350*dt);if(down)playerY=Math.min(H-ph,playerY+350*dt);
          const target=ball.y-ph/2;aiY+=Math.max(-250*dt,Math.min(250*dt,target-aiY));aiY=Math.max(0,Math.min(H-ph,aiY));
          ball.x+=ball.vx*dt;ball.y+=ball.vy*dt;
          if(ball.y<7){ball.y=7;ball.vy=Math.abs(ball.vy);}if(ball.y>H-7){ball.y=H-7;ball.vy=-Math.abs(ball.vy);}
          if(ball.vx<0&&ball.x-6<29&&ball.x>20&&ball.y+6>playerY&&ball.y-6<playerY+ph){ball.x=36;ball.vx=Math.abs(ball.vx)*1.035;ball.vy=(ball.y-(playerY+ph/2))*6;}
          if(ball.vx>0&&ball.x+6>W-29&&ball.x<W-20&&ball.y+6>aiY&&ball.y-6<aiY+ph){ball.x=W-36;ball.vx=-Math.abs(ball.vx)*1.035;ball.vy=(ball.y-(aiY+ph/2))*6;}
          if(ball.x<-15||ball.x>W+15){if(ball.x<-15)p2++;else p1++;$('#score').textContent=p1+' : '+p2;if(p1===5||p2===5){ended=true;$('#gameState').textContent='MATCH COMPLETE — PRESS ↻ TO RESTART';}else resetBall(ball.x<0?1:-1);}
        }draw();raf=requestAnimationFrame(frame);
      }resetBall(Math.random()<.5?1:-1);$('#score').textContent='0 : 0';$('#gameState').textContent='YOU VS CPU / FIRST TO FIVE';raf=requestAnimationFrame(frame);
      cleanupGame=()=>{cancelAnimationFrame(raf);window.removeEventListener('keydown',onKey);window.removeEventListener('keyup',keyUp);};
    }

    // SPACE INVADERS: moving formations, alien fire, lives, and wave clearing.
    function initInvaders(){
      const {canvas,ctx}=arcadeStage('← / → or A / D to move. SPACE to fire. Clear the alien formation before it reaches you.',480,480);
      const W=480,H=480;let shipX=226,left=false,right=false,firing=false,lastShot=0,lastEnemyShot=0,offset=0,down=0,dir=1,score=0,lives=3,ended=false,win=false,last=performance.now(),shots=[],enemyShots=[];
      const aliens=[];for(let r=0;r<4;r++)for(let c=0;c<9;c++)aliens.push({x:46+c*45,y:45+r*32,alive:true});
      function shoot(){if(ended||performance.now()-lastShot<230)return;shots.push({x:shipX+14,y:H-50});lastShot=performance.now();}
      function onKey(e){const d=directionFromKey(e.key);if(d==='left'||d==='right'){e.preventDefault();if(d==='left')left=true;else right=true;}if(e.code==='Space'){e.preventDefault();firing=true;shoot();}}
      function keyUp(e){const d=directionFromKey(e.key);if(d==='left')left=false;if(d==='right')right=false;if(e.code==='Space')firing=false;}
      window.addEventListener('keydown',onKey);window.addEventListener('keyup',keyUp);
      holdButton('◀',()=>left=true,()=>left=false);holdButton('FIRE ●',()=>{firing=true;shoot();},()=>firing=false);holdButton('▶',()=>right=true,()=>right=false);
      canvas.addEventListener('pointerdown',e=>{const r=canvas.getBoundingClientRect();shipX=Math.max(0,Math.min(W-28,(e.clientX-r.left)*W/r.width-14));shoot();});
      function draw(){
        ctx.fillStyle='#080808';ctx.fillRect(0,0,W,H);ctx.strokeStyle='#242424';for(let x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
        for(const a of aliens){if(!a.alive)continue;ctx.fillStyle='#fff';ctx.fillRect(a.x+offset,a.y+down,24,16);ctx.fillStyle='#000';ctx.fillRect(a.x+offset+4,a.y+down+6,5,5);ctx.fillRect(a.x+offset+15,a.y+down+6,5,5);}
        ctx.fillStyle='#00ff00';ctx.fillRect(shipX+8,H-40,12,12);ctx.fillRect(shipX,H-28,28,10);
        ctx.fillStyle='#00ff00';shots.forEach(b=>ctx.fillRect(b.x-2,b.y,4,15));ctx.fillStyle='#fff';enemyShots.forEach(b=>ctx.fillRect(b.x-2,b.y,4,11));
        ctx.fillStyle='#fff';ctx.font='600 12px Inter';ctx.fillText('LIVES: '+lives,15,20);ctx.fillText('ALIENS: '+aliens.filter(a=>a.alive).length,W-105,20);
        if(ended){ctx.fillStyle='#000d';ctx.fillRect(0,185,W,95);ctx.fillStyle='#fff';ctx.font='900 27px Inter';ctx.textAlign='center';ctx.fillText(win?'EARTH DEFENDED':'MISSION FAILED',W/2,238);ctx.textAlign='left';}
      }
      let raf;
      function frame(now){const dt=Math.min((now-last)/1000,.035);last=now;
        if(!ended){if(left)shipX=Math.max(0,shipX-280*dt);if(right)shipX=Math.min(W-28,shipX+280*dt);if(firing)shoot();
          let min=Infinity,max=-Infinity;aliens.forEach(a=>{if(a.alive){min=Math.min(min,a.x);max=Math.max(max,a.x+24);}});
          offset+=dir*(22+(36-aliens.filter(a=>a.alive).length)*1.5)*dt;
          if(min+offset<5||max+offset>W-5){dir*=-1;offset+=dir*7;down+=11;}
          shots.forEach(b=>b.y-=360*dt);enemyShots.forEach(b=>b.y+=185*dt);
          for(const b of shots){const a=aliens.find(a=>a.alive&&b.x>a.x+offset&&b.x<a.x+offset+24&&b.y<a.y+down+17&&b.y+15>a.y+down);if(a){a.alive=false;b.y=-100;score+=25;$('#score').textContent=score;}}
          shots=shots.filter(b=>b.y>-20);enemyShots=enemyShots.filter(b=>b.y<H+20);
          if(now-lastEnemyShot>1000){const alive=aliens.filter(a=>a.alive);if(alive.length){const a=alive[Math.floor(Math.random()*alive.length)];enemyShots.push({x:a.x+offset+12,y:a.y+down+20});}lastEnemyShot=now;}
          for(const b of enemyShots){if(b.x>shipX&&b.x<shipX+28&&b.y+11>H-40&&b.y<H-18){b.y=H+100;lives--;$('#gameState').textContent=lives?'HIT — KEEP FIGHTING':'ALL LIVES LOST';if(lives===0)ended=true;}}
          if(aliens.every(a=>!a.alive)){ended=true;win=true;$('#gameState').textContent='WAVE CLEARED — VICTORY';}
          if(aliens.some(a=>a.alive&&a.y+down+18>=H-43)){ended=true;$('#gameState').textContent='FORMATION REACHED THE GROUND';}
        }draw();raf=requestAnimationFrame(frame);
      }$('#gameState').textContent='DEFEND THE GROUND';raf=requestAnimationFrame(frame);
      cleanupGame=()=>{cancelAnimationFrame(raf);window.removeEventListener('keydown',onKey);window.removeEventListener('keyup',keyUp);};
    }

    // FLAPPY: independently playable tap-to-fly obstacle dodger.
    function initFlappy(){
      const {canvas,ctx}=arcadeStage('Tap the canvas, press SPACE or hit FLAP. Fly through the gaps and avoid hitting the pipes.',400,520);
      const W=400,H=520,ground=H-42;let y=ground/2,v=0,pipes=[],started=false,dead=false,score=0,elapsed=0,nextPipe=1,last=performance.now();
      function flap(){if(dead)return;if(!started){started=true;$('#gameState').textContent='KEEP FLYING';}v=-305;}
      function onKey(e){if(e.code==='Space'||e.key==='ArrowUp'){e.preventDefault();flap();}}
      window.addEventListener('keydown',onKey);canvas.addEventListener('pointerdown',flap);arcadeButton('FLAP ↑',flap);
      function draw(){
        ctx.fillStyle='#080808';ctx.fillRect(0,0,W,H);ctx.strokeStyle='#242424';for(let x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,ground);ctx.stroke();}
        for(const p of pipes){ctx.fillStyle='#fff';ctx.fillRect(p.x,0,62,p.top);ctx.fillRect(p.x,p.top+155,62,ground-p.top-155);ctx.fillStyle='#00ff00';ctx.fillRect(p.x-4,p.top-9,70,9);ctx.fillRect(p.x-4,p.top+155,70,9);}
        ctx.fillStyle='#fff';ctx.fillRect(0,ground,W,H-ground);ctx.fillStyle='#000';ctx.font='700 11px Inter';ctx.fillText('FLIGHT TEST / 002',15,ground+26);
        ctx.fillStyle='#00ff00';ctx.fillRect(107,y-12,25,24);ctx.fillStyle='#000';ctx.fillRect(123,y-5,4,5);
        if(!started||dead){ctx.fillStyle='#000c';ctx.fillRect(0,195,W,85);ctx.fillStyle='#fff';ctx.font='900 24px Inter';ctx.textAlign='center';ctx.fillText(dead?'CRASHED — RESTART ↻':'TAP TO FLY',W/2,240);ctx.textAlign='left';}
      }
      let raf;function frame(now){const dt=Math.min((now-last)/1000,.036);last=now;
        if(started&&!dead){elapsed+=dt;v+=870*dt;y+=v*dt;nextPipe-=dt;
          if(nextPipe<=0){const top=55+Math.floor(Math.random()*190);pipes.push({x:W+15,top,passed:false});nextPipe=1.55;}
          pipes.forEach(p=>{p.x-=174*dt;if(!p.passed&&p.x+62<108){p.passed=true;score++;$('#score').textContent=score;}if(132>p.x&&107<p.x+62&&(y-12<p.top||y+12>p.top+155))dead=true;});
          pipes=pipes.filter(p=>p.x>-80);if(y-12<0||y+12>=ground)dead=true;
          if(dead){$('#gameState').textContent='FLIGHT ENDED / SCORE '+score;if(score>safeGet('sii_flappy_best'))safeSet('sii_flappy_best',score);}
        }draw();raf=requestAnimationFrame(frame);
      }$('#gameState').textContent='BEST: '+safeGet('sii_flappy_best')+' / TAP TO START';raf=requestAnimationFrame(frame);
      cleanupGame=()=>{cancelAnimationFrame(raf);window.removeEventListener('keydown',onKey);};
    }

    // CONNECT FOUR: full 7×6 game, human vs tactical CPU or local two-player mode.
    function initConnect(){
      const stage=document.createElement('div');stage.className='connect-board';stage.setAttribute('role','grid');stage.setAttribute('aria-label','Connect Four game board');
      const side=sidePanel('Select a column to drop your disc. Make four in a row horizontally, vertically, or diagonally. Play against CPU or a friend.');gameLayout(stage,side);
      const R=6,C=7;let board=Array.from({length:R},()=>Array(C).fill(0)),player=1,ended=false,vsCpu=true,moves=0,cpuTimer=null;
      const modeBtn=arcadeButton('MODE: VS CPU',()=>{vsCpu=!vsCpu;modeBtn.textContent=vsCpu?'MODE: VS CPU':'MODE: 2 PLAYERS';newGame();});
      arcadeButton('NEW ROUND',newGame);
      function rowFor(col){for(let r=R-1;r>=0;r--)if(!board[r][col])return r;return -1;}
      function four(b,r,c,who){for(const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]){let n=1;for(const d of [-1,1]){let y=r+dr*d,x=c+dc*d;while(y>=0&&y<R&&x>=0&&x<C&&b[y][x]===who){n++;y+=dr*d;x+=dc*d;}}if(n>=4)return true;}return false;}
      function render(){stage.replaceChildren();for(let r=0;r<R;r++)for(let c=0;c<C;c++){const b=document.createElement('button');b.type='button';b.className='connect-cell'+(board[r][c]?' disc-'+board[r][c]:'');b.dataset.col=String(c);b.setAttribute('aria-label',`Column ${c+1}, row ${r+1}${board[r][c]?', occupied by player '+board[r][c]:', empty'}`);b.textContent=board[r][c]?'●':'○';b.disabled=ended||vsCpu&&player===2;stage.append(b);}$('#score').textContent=String(moves).padStart(2,'0');}
      function newGame(){if(cpuTimer!==null)clearTimeout(cpuTimer);cpuTimer=null;board=Array.from({length:R},()=>Array(C).fill(0));player=1;ended=false;moves=0;$('#gameState').textContent=vsCpu?'YOUR TURN / GREEN DISC':'PLAYER 1 / GREEN DISC';render();}
      function place(col){if(ended||rowFor(col)<0)return false;const r=rowFor(col);board[r][col]=player;moves++;const who=player;
        if(four(board,r,col,player)){ended=true;$('#gameState').textContent=vsCpu?(who===1?'YOU WIN!':'CPU WINS'):`PLAYER ${who} WINS!`;}
        else if(moves===R*C){ended=true;$('#gameState').textContent='DRAW GAME — FULL BOARD';}
        else{player=3-player;$('#gameState').textContent=vsCpu?(player===1?'YOUR TURN':'CPU THINKING...'):`PLAYER ${player}'S TURN`;}
        render();return true;
      }
      function cpuChoice(){
        const legal=Array.from({length:C},(_,c)=>c).filter(c=>rowFor(c)>=0);
        for(const who of [2,1])for(const c of legal){const r=rowFor(c);board[r][c]=who;const win=four(board,r,c,who);board[r][c]=0;if(win)return c;}
        const preference=[3,2,4,1,5,0,6];return preference.filter(c=>legal.includes(c))[Math.floor(Math.random()*Math.min(3,legal.length))]??legal[0];
      }
      stage.addEventListener('click',e=>{const b=e.target.closest('[data-col]');if(!b||ended||vsCpu&&player===2)return;if(place(Number(b.dataset.col))&&vsCpu&&!ended){cpuTimer=setTimeout(()=>{cpuTimer=null;if(!ended)place(cpuChoice());},320);}});
      newGame();cleanupGame=()=>{if(cpuTimer!==null)clearTimeout(cpuTimer);};
    }


    const games = {snake:initSnake, '2048':init2048, mines:initMines, memory:initMemory,
      tetris:initTetris, breakout:initBreakout, pong:initPong, invaders:initInvaders,
      flappy:initFlappy, connect:initConnect};
    games[id]();
    return cleanupGame;
}
