import chalk from 'chalk';
import fs from 'fs';
import readline from 'readline';
import { spawn } from 'child_process';
import WebTorrent from 'webtorrent';
import http from 'http';
import LRUCacheStore from './cacheStore.js';

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
}

const asciiArt = fs.readFileSync('src/ascii.txt', 'utf-8');
const watchHeader = fs.readFileSync('src/watchHeader.txt', 'utf-8');
const browseHeader = fs.readFileSync('src/browseHeader.txt', 'utf-8');

const menuItems = ['Browse', 'Watch'];
const browseItems = ['Go back', 'Query'];
const watchItems = ['Go back', 'Enter Magnet Link'];

let curMenu = 'default';
let selectedIndex = 0;

const render = () => {
    console.clear();

    console.log(chalk.hex('#3884ffff').bold(asciiArt));
    console.log();

    // Display menu items
    menuItems.forEach((item, index) => {
        if (index === selectedIndex) {
            console.log('> ' + chalk.hex('#db68adff').bold.underline(item));
        } else {
            if (item === 'Browse') {
                console.log('  ' + chalk.green(item));
            } else if (item === 'Watch') {
                console.log('  ' + chalk.blue(item));
            } else {
                console.log('  ' + chalk.white(item));
            }
        }
    });

    console.log();
    console.log(chalk.gray('Use ↑/↓ or j/k to navigate, Enter to select, q/Esc to quit'));
}

const drawBox = (lines, color = '#00FFFF') => {
    lines = lines.map(String);

    const stripAnsi = str => str.replace(/\x1B\[[0-9;]*m/g, '');
    const maxLen = Math.max(...lines.map(l => stripAnsi(l).length));

    const top = `┌${'─'.repeat(maxLen + 2)}┐`;
    const bottom = `└${'─'.repeat(maxLen + 2)}┘`;

    let out = chalk.hex(color)(top) + "\n";

    for (const line of lines) {
        const visibleLen = stripAnsi(line).length;
        const padding = ' '.repeat(maxLen - visibleLen);
        out += chalk.hex(color)("│ ") + line + padding + chalk.hex(color)(" │") + "\n";
    }

    out += chalk.hex(color)(bottom);

    return out;
}

const spinnerAnimation = () => {
    const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    const spinnerInterval = setInterval(() => {
        process.stdout.write('\r' + chalk.hex('#FF69B4')(spinner[i]) + ' ' + chalk.dim('Connecting to peers...'));
        i = (i + 1) % spinner.length;
    }, 80);
    return spinnerInterval;
}

const browseScreen = () => {
    console.clear();

    console.log(chalk.hex('#3884ffff').bold(browseHeader));
    console.log();

    browseItems.forEach((item, index) => {
        if (index === selectedIndex) {
            console.log('> ' + chalk.hex('#db68adff').bold.underline(item));
        } else {
            if (item === 'Go back') {
                console.log('  ' + chalk.red(item));
            } else {
                console.log('  ' + chalk.white(item));
            }
        }
    });

    console.log();
    console.log(chalk.gray('Use ↑/↓ or j/k to navigate, Enter to select, q/Esc to quit'));
}

const watchScreen = () => {
    console.clear();

    console.log(chalk.blue.bold(watchHeader));
    console.log();

    watchItems.forEach((item, index) => {
        if (index === selectedIndex) {
            console.log('> ' + chalk.hex('#db68adff').bold.underline(item));
        } else {
            if (item === 'Go back') {
                console.log('  ' + chalk.red(item));
            } else if (item === 'Enter Magnet Link') {
                console.log('  ' + chalk.cyan(item));
            } else {
                console.log('  ' + chalk.white(item));
            }
        }
    });

    console.log();
    console.log(chalk.gray('Use ↑/↓ or j/k to navigate, Enter to select, q/Esc to quit'));
}

const startTorrentStream = () => {
    curMenu = 'watch-input';

    // Disable raw mode to allow input
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const magnetPrompt = chalk.hex('#00FFFF')('┌─') +
        chalk.hex('#00E5E5')('[') +
        chalk.hex('#00CCCC')(' Magnet Link ') +
        chalk.hex('#00E5E5')(']') +
        '\n' +
        chalk.hex('#00FFFF')('└─> ');

    rl.question(magnetPrompt, (magnetLink) => {
        if (magnetLink.trim()) {
            console.log(chalk.greenBright(`\n✓ Magnet link received: ${magnetLink.substring(0, 50)}...`));

            rl.question(chalk.cyan('Enter preferred player (mpv/vlc) [default: mpv]: '), (player) => {
                rl.close();
                const selectedPlayer = player.trim() || 'mpv';

                console.log();
                console.log(chalk.hex('#FFD700')('Initializing WebTorrent Engine...'));
                console.log();

                const spin = spinnerAnimation();

                const client = new WebTorrent();

                client.add(magnetLink, { path: 'temp', store: LRUCacheStore }, (torrent) => {
                    clearInterval(spin);
                    process.stdout.write('\r' + ' '.repeat(50) + '\r');

                    const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.mkv') || f.name.endsWith('.avi'));

                    if (!file) {
                        console.log(chalk.red('No video file found in torrent.'));
                        client.destroy();
                        returnToMenu();
                        return;
                    }

                    console.log(chalk.hex('#00FF00')('✓ ') + chalk.hex('#00E500')('Connected to swarm'));
                    console.log();
                    const box = drawBox([
                        chalk.bold("File: ") + chalk.white(file.name),
                        chalk.bold("Size: ") + chalk.white((file.length / (1024 * 1024)).toFixed(2) + " MB"),
                        chalk.bold("Player: ") + chalk.white(selectedPlayer.toUpperCase()),
                    ]);
                    console.log(box);
                    console.log();
                    console.log(chalk.hex('#ffd700')(`Starting local server...`));

                    const server = http.createServer((req, res) => {
                        const range = req.headers.range;

                        if (!range) {
                            res.setHeader('Content-Length', file.length);
                            res.setHeader('Content-Type', 'video/mp4');
                            const stream = file.createReadStream();
                            stream.pipe(res);
                            stream.on('error', () => { });
                            return;
                        }

                        const parts = range.replace(/bytes=/, "").split("-");
                        const start = parseInt(parts[0], 10);
                        const end = parts[1] ? parseInt(parts[1], 10) : file.length - 1;
                        const chunksize = (end - start) + 1;

                        res.writeHead(206, {
                            'Content-Range': `bytes ${start}-${end}/${file.length}`,
                            'Accept-Ranges': 'bytes',
                            'Content-Length': chunksize,
                            'Content-Type': 'video/mp4',
                        });

                        const stream = file.createReadStream({ start, end });
                        stream.pipe(res);
                        stream.on('error', () => { });
                    });

                    server.listen(0, () => {
                        const port = server.address().port;
                        const url = `http://localhost:${port}/`;

                        console.log(chalk.hex('#00FF00')('✓ ') + chalk.hex('#00E500')('Server running at ') + chalk.underline(url));
                        console.log(chalk.hex('#FFD700')('▶  Launching ' + selectedPlayer + '...'));

                        const playerProc = spawn(selectedPlayer, [url], {
                            stdio: 'ignore',
                            detached: false
                        });

                        playerProc.on('close', (code) => {
                            console.log(chalk.dim('Player closed'));
                            server.close();
                            client.destroy();
                            returnToMenu();
                        });
                    });

                    let lastProgress = 0;
                    torrent.on('download', (bytes) => {
                        const progress = (torrent.progress * 100).toFixed(1);
                        if (progress - lastProgress >= 1) {
                            lastProgress = progress;
                            const downloadSpeed = (torrent.downloadSpeed / (1024 * 1024)).toFixed(2);
                            const downloaded = (torrent.downloaded / (1024 * 1024)).toFixed(2);
                            const total = (torrent.length / (1024 * 1024)).toFixed(2);

                            const barLength = 30;
                            const filled = Math.floor((progress / 100) * barLength);
                            const empty = barLength - filled;
                            const bar = chalk.hex('#00FF00')('█').repeat(filled) +
                                chalk.dim('░').repeat(empty);

                            process.stdout.write(
                                '\r' +
                                chalk.hex('#00FFFF')('Progress: ') +
                                bar + ' ' +
                                chalk.bold(progress + '%') + ' ' +
                                chalk.dim(`(${downloaded}/${total} MB)`) + ' ' +
                                chalk.hex('#FFD700')(`↓ ${downloadSpeed} MB/s`) +
                                ' '.repeat(5)
                            );
                        }
                    });
                });
            });
        } else {
            rl.close();
            console.log(chalk.red('\n✗') + chalk.dim(' No magnet link provided'));
            returnToMenu();
        }
    });
}

const returnToMenu = () => {
    setTimeout(() => {
        curMenu = 'default';
        selectedIndex = 0;
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
            process.stdin.resume();
        }
        render();
    }, 1000);
}

const handleSelection = () => {
    if (curMenu === 'browse') {
        const selected = browseItems[selectedIndex];

        if (selected === 'Go back') {
            curMenu = 'default';
            selectedIndex = 0;
            render();
        } else if (selected === 'Query') {
            console.clear();
            console.log(chalk.green(`\nYou selected: ${selected}`));
            console.log('Opening query...');
        }
    } else if (curMenu === 'watch') {
        const selected = watchItems[selectedIndex];

        if (selected === 'Go back') {
            curMenu = 'default';
            selectedIndex = 0;
            render();
        } else if (selected === 'Enter Magnet Link') {
            console.clear();
            startTorrentStream();
        }
    } else {
        const selected = menuItems[selectedIndex];

        if (selected === 'Browse') {
            curMenu = 'browse';
            selectedIndex = 0;
            browseScreen();
        } else if (selected === 'Watch') {
            curMenu = 'watch';
            selectedIndex = 0;
            watchScreen();
        }
    }
}

// Handle keypresses
process.stdin.on('keypress', (str, key) => {
    if (!key) return;

    if (curMenu === 'watch-input') return;

    if (key.name === 'escape' || key.name === 'q' || (key.ctrl && key.name === 'c')) {
        process.exit(0);
    }

    // Navigation
    if (key.name === 'up' || key.name === 'k') {
        switch (curMenu) {
            case 'browse':
                selectedIndex = (selectedIndex - 1 + browseItems.length) % browseItems.length;
                browseScreen();
                break;
            case 'watch':
                selectedIndex = (selectedIndex - 1 + watchItems.length) % watchItems.length;
                watchScreen();
                break;
            case 'default':
                selectedIndex = (selectedIndex - 1 + menuItems.length) % menuItems.length;
                render();
                break;
        }
    } else if (key.name === 'down' || key.name === 'j') {
        switch (curMenu) {
            case 'browse':
                selectedIndex = (selectedIndex + 1) % browseItems.length;
                browseScreen();
                break;
            case 'watch':
                selectedIndex = (selectedIndex + 1) % watchItems.length;
                watchScreen();
                break;
            case 'default':
                selectedIndex = (selectedIndex + 1) % menuItems.length;
                render();
                break;
        }
    } else if (key.name === 'return') {
        handleSelection();
    }
});

render();