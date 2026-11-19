# Ecos de Valdora

Uma aventura de ação 3D **original** que roda direto no navegador, com visual low-poly no estilo da era N64. Explore a Vila Brisa, aprenda canções numa flauta mágica, enfrente goblins e esqueletos e desperte o Santuário da Raiz para derrotar o Guardião Musgoso.

Feito com **Three.js** e JavaScript puro (ES modules). Não precisa de build nem de assets externos: modelos, terreno, música e efeitos sonoros são todos gerados por código.

## Como rodar

Os ES modules exigem um servidor HTTP (abrir o `index.html` direto pelo `file://` não funciona).

```bash
git clone https://github.com/davipcosta/ecos-de-valdora.git
cd ecos-de-valdora
python3 -m http.server 8000
```

Depois abra <http://localhost:8000> no navegador. Qualquer servidor estático serve (`npx serve`, extensão Live Server do VS Code etc.).

> O Three.js e as fontes são carregados por CDN, então você precisa de internet na primeira vez.

## Controles

| Ação | Teclado / mouse | Gamepad |
|---|---|---|
| Mover | WASD / setas | Analógico esquerdo |
| Câmera | Mouse (clique na tela para travar o ponteiro) | Analógico direito |
| Correr | Shift | L3 |
| Atacar (segure para o golpe giratório) | J / botão esquerdo | X |
| Escudo | K / botão direito | RB |
| Rolar | Espaço | A |
| Travar no alvo | Q | LB / LT |
| Interagir / falar | E | Y |
| Abrir a flauta | F | B |
| Notas da flauta | 1 – 5 | D-pad + RT |
| Falar com a Lume | C | Select |
| Pausar | Esc / P | Start |

## A aventura

1. Você acorda na **Vila Brisa**. A Lume, sua companheira de luz, sugere falar com o ancião **Orvo**.
2. Orvo entrega a **Flauta dos Ventos** e ensina a **Canção da Aurora**, que alterna entre dia e noite.
3. No **Bosque Sussurrante**, livre a clareira dos inimigos para que **Mira** ensine a **Canção do Santuário**.
4. Toque a canção diante da porta do **Santuário da Raiz**, ao norte.
5. Lá dentro, encontre a chave, abra o portão e enfrente o **Guardião Musgoso**.

Além disso: corte grama para achar gemas e corações, cuidado com os esqueletos que aparecem à noite, e junte 100 gemas para comprar um Contêiner de Coração com o mercador Brom. Se ficar perdido, aperte **C** para pedir uma dica à Lume.

<details>
<summary>Spoiler: as canções</summary>

- **Canção da Aurora:** 1 3 5 3 1
- **Canção do Santuário:** 2 4 2 5 4

</details>

## Estrutura do projeto

```
index.html        # shell da página, HUD, estilos e importmap do Three.js
src/
  main.js         # loop, câmera em 3ª pessoa, quest, NPCs, baús e integração
  world.js        # terreno, céu, ciclo dia/noite, água, templo e colisões
  player.js       # herói: movimento, combate, rolamento e escudo
  enemies.js      # inimigos, IA e o chefe
  models.js       # todos os modelos 3D procedurais
  audio.js        # música e efeitos sintetizados com WebAudio
  input.js        # teclado, mouse (pointer lock) e gamepad
  ui.js           # HUD, diálogos, minimapa e telas de título e fim de jogo
```

## Modo debug

Adicione `?debug` à URL (`http://localhost:8000/?debug`) para liberar estes atalhos:

| Tecla | Efeito |
|---|---|
| G | Ganha a flauta, as duas canções, uma chave e 100 gemas |
| T | Teleporta para a porta do templo |
| B | Abre o templo e teleporta para a sala do chefe |
| N | Alterna entre dia e noite |
| H | Cura toda a vida |

## Tecnologias

- [Three.js](https://threejs.org/) 0.160.0
- WebAudio API, para música e efeitos 100% procedurais
- Gamepad API e Pointer Lock API
