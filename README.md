# RastaME MR

Experimento de **realidade mista com gamepad**: controle de PS4 + **um único celular Android**.
O ARCore faz o SLAM (pose da câmera) e o depth; o app transforma isso num mapa de voxels em
**escala 1:1 (metros, gravidade 9,81 m/s²)**, e o seu avatar do VoxEdit (`ME002/`) anda, corre, pula,
cai da mesa, empurra caixas e leva bolada **nas superfícies reais**. O backend recebe o SLAM em tempo
real, funde uma nuvem de pontos e grava sessões para reconstrução 3D.

```
 Celular Android (Chrome, WebXR + ARCore)                      PC (backend Node)
 ┌───────────────────────────────────────────┐   WebSocket   ┌──────────────────────────────┐
 │ PS4 (Bluetooth) → Gamepad API             │  depth+pose   │ funde nuvem de pontos (2 cm) │
 │ SLAM/pose + depth ARCore → mapa de voxels ├──────────────►│ viewer ao vivo (viewer.html) │
 │ voxels → colisores Rapier (física 1:1)    │  estado jogo  │ exporta .ply                 │
 │ voxels → oclusão + sombra no mundo real   ├──────────────►│ grava sessões p/ reconstrução│
 │ avatar voxel animado (VoxEdit)            │               └──────────────────────────────┘
 └───────────────────────────────────────────┘
```

A física roda **no celular** (sem latência de rede). O backend é opcional para jogar; ele é a parte
de "nuvem de pontos / reconstrução".

## Rodar

```bash
npm install
npm start            # backend em http://<ip-do-pc>:8080 (e https em :8443 se houver certs/)
```

- **Simulador no PC** (sem celular): `http://localhost:8080/?sim=1` — mesa de bar falsa, depth sintético
  no mesmo formato do ARCore, mesmo pipeline. Funciona com o PS4 ligado no PC (USB/Bluetooth) ou teclado.
- **Viewer da nuvem de pontos**: `http://localhost:8080/viewer.html`
- **Avatar e animações**: `http://localhost:8080/avatar.html`

### No celular — jeito mais fácil (Vercel, HTTPS pronto)

O WebXR só abre em página HTTPS. Publicando na Vercel o app já sai em HTTPS:

1. Commit + push deste repositório para o GitHub.
2. Na Vercel: **Add New › Project**, importe o repositório. O `vercel.json` já configura tudo
   (build `npm run build` → pasta `dist/`). Não precisa de variável de ambiente.
3. No celular Android, abra `https://<seu-projeto>.vercel.app` no **Chrome** → **Entrar no mundo** e permita a câmera.
4. Mova o celular devagar sobre a mesa ou o chão. Uma **prévia translúcida** do avatar aparece no alvo;
   quando o alvo fica **verde** (estável), toque em **Colocar aqui**. O avatar fica ancorado ao ponto físico
   (âncora do ARCore).
5. Controles na tela:
   - **joystick flutuante**: encoste o polegar em qualquer lugar da metade esquerda; arrastar além da borda = correr;
   - **Pular** (botão grande), **Bola**, **Caixa**, **Oi** no canto direito;
   - topo: **alvo** (traz o avatar para onde a câmera mira), **⋯** menu (emotes, tamanho, malha, oclusão, gravar), **✕** sair.
   Se o avatar sair da tela, uma **seta** na borda aponta para ele.
   Funciona **em pé ou deitado** (segue o giro do celular; dá para travar na horizontal em Ajustes)
   e o layout se adapta a retrato, paisagem e tablet.
   A **oclusão** (avatar escondido atrás de objetos reais) vem **desligada**: o depth do celular tem ruído que fazia
   o avatar sumir. Ligue no menu ⋯ › Oclusão quando o mapa estiver limpo (aí ele aparece como silhueta atrás das coisas).
   Com o PS4 pareado, os controles da tela somem e vale o controle.

Na Vercel não há backend: o AR, a física e o avatar funcionam 100% no celular; só a nuvem de pontos no PC
(viewer/gravação) precisa do `npm start` local, abaixo. O app só tenta falar com o backend quando é aberto
pelo IP da rede local (`192.168.x.x`, `10.x.x.x`, `localhost`…) ou com `?backend=1` no link — na Vercel ele
não fica mais tentando conectar.

### No celular — com o backend local (nuvem de pontos no PC)

1. **Parear o PS4**: segure **PS + Share** até a luz piscar rápido → Android › Bluetooth › parear "Wireless Controller".
2. Celular e PC no mesmo Wi-Fi. O WebXR só abre em página **segura**; escolha uma opção:
   - **Flag do Chrome (mais simples):** abra `chrome://flags/#unsafely-treat-insecure-origin-as-secure`,
     coloque `http://<ip-do-pc>:8080`, ative e reinicie o Chrome. Depois abra `http://<ip-do-pc>:8080`.
   - **HTTPS:** `npm run cert` (gera certificado com os IPs da rede), `npm start` e abra
     `https://<ip-do-pc>:8443` aceitando o aviso de certificado.
3. Aperte **Entrar em AR**, mova o celular devagar sobre a mesa/chão e aperte **✕** para colocar o avatar.

Precisa de um aparelho com **ARCore** (Google Play Services for AR). Com **Depth API** o mapa sai do
depth denso; sem ela, o app usa uma grade de 24 hit-tests nos planos do ARCore (funciona, mas só mapeia planos).

## Controles

| Botão | Ação |
|---|---|
| Analógico esq. | andar/correr relativo à câmera (anéis no chão mostram o stick, como no vídeo) |
| R2 (pressão) / L2 | sprint proporcional / andar devagar |
| ✕ | colocar o avatar · pular |
| ○ ou toque na tela | arremessar bolinha de tênis (58 g, r 3,3 cm) |
| △ | derrubar uma caixa na frente do avatar |
| □ | acenar · Direcional: ↑ comemorar, ↓ sentar, ← palmas, → danças |
| L1 / R1 | diminuir / aumentar o avatar (6 cm a 2 m) |
| R3 / L3 | recolocar no alvo / liga-desliga oclusão |
| Options / Share / Touchpad | malha de voxels (debug) / gravar sessão / apagar mapa |

Teclado (PC): WASD, Espaço, Shift, G, F, E, setas, Q/R, P, C, V, M; IJKL orbita a câmera no simulador.

## Reconstrução 3D

Share no controle (ou "Gravar sessão" no viewer) grava `data/session-*/frames.rmd` (depth + pose + projeção crus)
e `cloud.ply`. Depois:

```bash
python tools/reconstruct_open3d.py data/session-XXXX            # nuvem fundida 1 cm (só numpy)
pip install open3d
python tools/reconstruct_open3d.py data/session-XXXX --mesh     # malha TSDF
```

`/api/map.ply` baixa a nuvem atual a qualquer momento.

## Avatar (VoxEdit → web)

`npm run avatar` converte `ME002/` para `web/assets/avatar.json` (`tools/vox2json.py`). Os formatos
`.vxm`/`.vxr`/`.vxa` foram decifrados nesse script (documentados no topo dele): 16 partes, 17 ossos
e 29 animações (idle, andar, correr, sprint, pulo, aterrissar, acenos, danças…). Para trocar ou adicionar
animações, edite o dicionário `ANIMS`. Paleta é BGR; o espaço é mão-esquerda (Unity), convertido espelhando Z.

## Estrutura

```
server/server.js      backend: estáticos, WebSocket, fusão de voxels, gravação, PLY
shared/               código comum celular+servidor: depth.js (desprojeção), voxelmap.js, protocol.js, mat4.js
web/index.html        app AR/simulador · js/app.js (loop), world.js (Rapier + colisores), mapper.worker.js (depth → voxels), character.js,
                      avatar.js, gamepad.js, hud.js (HUD, joystick, menu), games.js (minigames), sfx.js (sons), music.js (trilha Audius), net.js, sim.js · viewer.html + js/viewer.js
tools/                vox2json.py, reconstruct_open3d.py, make-cert.mjs, build.mjs (gera dist/ para a Vercel)
test/                 npm test — matemática do depth (inclui buffer girado de celular em retrato), protocolo, mapa
```

## Depth real (ruído) — como o app lida

O depth do ARCore em mesas lisas tem vários cm de ruído. Para o avatar não afundar nem travar:
- **planos do ARCore como verdade**: pontos de depth a até ~4 cm de um plano horizontal detectado são colados no plano;
- **autocalibração** da orientação do depth nos primeiros quadros (compara com o plano do alvo; o chip "depth" mostra `↕` se invertido);
- o avatar **nasce em cima** do que houver no alvo e é **destravado** se o chão ruidoso surgir por cima dos pés;
- o **chão físico** vem do plano real do chão detectado pelo ARCore (não só da estimativa do `local-floor`);
- a oclusão desce 2 cm, então o ruído da superfície não esconde os pés.

No simulador dá para reproduzir: `?sim=1&noise=0.04` (4% de ruído).

## Interação, escalada e minigames

- **Pegar** (□ no PS4): pega a bola/caixa ao alcance (o botão brilha), carrega com os braços à frente;
  **Soltar** (□) ou **Jogar** (○) com física real. Nos minigames o arremesso tem **mira assistida**.
- **Caixa** (△) tem meia altura do avatar: dá para **subir** nela e empilhar.
- **Escalada**: degraus até ~½ altura ele sobe sozinho ao empurrar; bordas até ~1 altura, pule de frente
  para elas (animação "Mantle" do VoxEdit).
- **Escaneamento guiado** ao entrar (barra de cobertura, "Superfície ✓ · Chão ✓"); refazer em ⋯ › Escanear.
- **Minigames** (⋯ › Minigames), com contagem, placar, sons e recorde salvo no aparelho:
  1. Caça às Moedas · 2. Corrida dos Anéis · 3. Basquete Rasta · 4. Boliche · 5. Torre da Estrela.
  Tudo é posicionado nas superfícies que a câmera mapeou e dimensionado pela altura do avatar.

Captação do ambiente: filtro de "pixels voadores" nas bordas dos objetos, 3 leituras para confirmar um voxel e
preenchimento de buracos dentro de planos (sombra atrás de objetos), sem fechar as bordas reais da mesa.

## Botões, jogos e trilha sonora

- **Jogos** em destaque no topo (abre o painel de minigames com ícones e recordes).
- Botões com **leque** (os "•••"): tocar = ação padrão; **segurar** abre 3 opções em coluna — arraste até uma
  e solte (ou solte e toque). **Objeto**: Bola · Caixa · Limpar. **Emote**: Acenar · Dançar · Comemorar.
- **Trilha sonora**: playlist [CryptoRastas Family](https://audius.co/digitaldubs/playlist/cryptorastas-family-playlist)
  tocada pela API pública do Audius (`web/js/music.js`), lida ao vivo e embaralhada; menu ⋯ › Música / Próxima.
- Pose de carregar corrigida: braços à frente (antes iam para trás).

## Portais RastaVerse

No painel **Jogos**, seção **Portais**: abre um portal 3D (ou os 3) em volta do avatar, sempre no chão
nivelado com ele. Leve o avatar até um portal: ele é sugado (giro, clarão, som) e o app vai para o jogo —
[Rasta Memo](https://rastamemo.vercel.app/), [Rasta Runner](https://rastarunner.vercel.app/),
[Rastetris](https://rastetris.vercel.app/). Destinos, cores e nomes ficam em `DESTS` (`web/js/portals.js`).

## Aparelhos sem WebXR AR (iPhone, Android sem ARCore)

`web/js/camview.js`: câmera traseira em vídeo ao fundo + giroscópio (DeviceOrientation, com o pedido de
permissão do iOS feito no toque de "Entrar no mundo"). O chão real é um plano 1,35 m abaixo do celular
(`CAM_H`), mapeado num raio de 2,4 m em volta do usuário — avatar, objetos, minigames e portais funcionam
nele. Sem posição do celular (só rotação) e sem mesa/depth: o avatar fica no chão. A música libera o
`<audio>` no próprio toque (exigência do Safari).

## Fluidez (revisão de desempenho)

Medido no simulador com CPU 4× mais lenta, avatar andando (física + movimento por quadro):
- o filtro do controlador do avatar era um predicado em JS chamado para cada colisor por perto (29% da CPU
  em exceções internas do Rapier) → trocado pelo filtro nativo `EXCLUDE_SENSORS`;
- o mapa era milhares de cuboides soltos (11 ms por passo de física) → **malhas por bloco 16×16×16** com só as
  faces expostas e **topos mesclados** (greedy meshing) na altura medida: passo de física ~0,5 ms;
- altura do avatar suavizada só no visual (sem tremer nos degrauzinhos do mapa); aceleração/giro mais rápidos;
- sem "puxões" da âncora do ARCore; upload parcial das instâncias da malha de debug.

Total física + movimento: de ~13 ms para ~3,6 ms por quadro.

## Escaneamento 360°

Ao entrar: radar com 12 setores (gire em volta de você), malha aparecendo e, quando o chão é achado (plano a
mais de 90 cm abaixo do celular), uma **grade com anel brilhante marca a linha do chão** no mundo real — e ele
vira o chão físico na hora. "Pronto" libera com 10/12 setores e alguma superfície; "Pular" sempre disponível.

## Desempenho

- o depth do ARCore é processado num **Web Worker** (`web/js/mapper.worker.js`): a tela nunca espera o mapa;
- colisores entram aos poucos (120 por quadro), mapa limitado a 2,8 m da câmera;
- AR renderizado a 80% da resolução nativa, sombra 512 px recalculada a cada 2 quadros;
- HUD sem `backdrop-filter` (desfoque sobre a câmera custava caro na GPU todo quadro).

No simulador com CPU 4× mais lenta: de ~4,6 para ~27 FPS (quadro típico de 267 ms para 24 ms).

## Limites conhecidos

- Testado de ponta a ponta no **simulador** e no viewer; a sessão WebXR real (depth do ARCore,
  hit-test, dom-overlay, Gamepad dentro do AR) depende do aparelho e ainda precisa ser validada no celular.
- Objetos que se mexem são apagados do mapa aos poucos (carving por raio livre); pessoas passando podem
  deixar "fantasmas" por alguns segundos.
- A pose do ARCore pode dar saltos ao relocalizar; o mapa não é corrigido retroativamente (sem loop closure no backend).
