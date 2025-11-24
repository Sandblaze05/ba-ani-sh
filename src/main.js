import chalk from 'chalk';
import fs from 'fs';
import readline from 'readline';
import { spawn } from 'child_process';
import WebTorrent from 'webtorrent';
import http from 'http';

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
}

const asciiArt = fs.readFileSync('src/ascii.txt', 'utf-8');

const menuItems = ['Browse', 'Watch'];
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

const browseItems = ['Go back', 'Query'];

const browseScreen = () => {
    console.clear();

    console.log(chalk.hex('#3884ffff').bold(asciiArt));
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
        curMenu = 'default';
        selectedIndex = 0;
        render();
    } else {
        const selected = menuItems[selectedIndex];

        if (selected === 'Browse') {
            curMenu = 'browse';
            selectedIndex = 0;
            browseScreen();
        } else if (selected === 'Watch') {
            console.log();
            console.log(chalk.blue.bold('\n ▶ Watch Anime\n'));
            // console.log(chalk.cyanBright('Enter magnet link: '));
            console.log();

            curMenu = 'watch';

            // Disable raw mode to allow input
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
            }

            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            rl.question(chalk.cyanBright('Enter magnet link: '), (magnetLink) => {

                if (magnetLink.trim()) {
                    console.log(chalk.greenBright(`\n✓ Magnet link received: ${magnetLink.substring(0, 50)}...`));

                    rl.question(chalk.cyan('Enter preferred player (mpv/vlc) [default: mpv]: '), (player) => {
                        rl.close();
                        const selectedPlayer = player.trim() || 'mpv';

                        console.log(chalk.yellow(`\nInitializing WebTorrent engine...`));

                        const client = new WebTorrent();

                        client.add(magnetLink, (torrent) => {
                            // Find the largest file (usually the video)
                            const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.mkv') || f.name.endsWith('.avi'));

                            if (!file) {
                                console.log(chalk.red('No video file found in torrent.'));
                                client.destroy();
                                return;
                            }

                            console.log(chalk.green(`\nFound: ${file.name}`));
                            console.log(chalk.yellow(`Starting local server...`));

                            // Create a local streaming server
                            const server = http.createServer((req, res) => {
                                const range = req.headers.range;

                                if (!range) {
                                    res.setHeader('Content-Length', file.length);
                                    res.setHeader('Content-Type', 'video/mp4');
                                    file.createReadStream().pipe(res);
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

                                file.createReadStream({ start, end }).pipe(res);
                            });

                            server.listen(0, () => {
                                const port = server.address().port;
                                const url = `http://localhost:${port}/${0}`;

                                console.log(chalk.green(`Streaming from: ${url}`));
                                console.log(chalk.yellow(`Launching ${selectedPlayer}...`));

                                // Spawn the player pointing to the local HTTP URL
                                const playerProc = spawn(selectedPlayer, [url], {
                                    stdio: 'ignore',
                                    detached: false
                                });

                                playerProc.on('close', (code) => {
                                    console.log(chalk.gray(`Player closed.`));
                                    server.close();
                                    client.destroy();

                                    // Return to menu logic here
                                    setTimeout(() => {
                                        curMenu = 'default';
                                        selectedIndex = 0;
                                        if (process.stdin.isTTY) {
                                            process.stdin.setRawMode(true);
                                            process.stdin.resume();
                                        }
                                        render();
                                    }, 1000);
                                });
                            });

                            torrent.on('download', (bytes) => {

                            });
                        });
                    })


                } else {
                    rl.close();
                    console.log(chalk.red('\n✗ No magnet link provided'));

                    setTimeout(() => {
                        curMenu = 'default';
                        selectedIndex = 0;
                        // enable raw mode again
                        if (process.stdin.isTTY) {
                            process.stdin.setRawMode(true);
                            process.stdin.resume();
                        }
                        render();
                    }, 1000);
                }
            });

            curMenu = 'watch';
        }
    }
}



// Handle keypresses
process.stdin.on('keypress', (str, key) => {
    // console.log('DEBUG: keypress received', key?.name, 'curMenu:', curMenu);
    if (!key) return;

    if (curMenu === 'watch') return;

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
            case 'default':
                selectedIndex = (selectedIndex + 1) % menuItems.length;
                render();
                break;
        }
    } else if (key.name === 'return') {
        handleSelection();
    }
});

// process.on('SIGINT', () => {
//     console.warn('sigint');
// })


render();