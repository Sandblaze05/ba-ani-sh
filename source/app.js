import React, { useEffect, useState, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import LRUCacheStore from './cacheStore.js'
import { spawn } from 'child_process';
import wrapAnsi from 'wrap-ansi';
import http from 'http';
import fs from 'fs'
import WebTorrent from 'webtorrent';

const headerAscii = fs.readFileSync('constants/ascii.txt', 'utf-8');
const browseAscii = fs.readFileSync('constants/browse.txt', 'utf-8');
const watchAscii = fs.readFileSync('constants/watch.txt', 'utf-8');

const menuItems = ['Browse', 'Watch'];

const Spinner = () => {
  const [frame, setFrame] = useState(0);
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % frames.length);
    }, 80);

    return () => clearInterval(timer);
  }, []);

  return <Text>{frames[frame]}</Text>;
};

process.stdout.write("\x1b[2J\x1b[0f");

export default function App() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [curMenu, setCurMenu] = useState('main'); // 'main' | 'browse' | 'watch'
  const [magnetLink, setMagnetLink] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [downloaded, setDownloaded] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [playerChoice, setPlayerChoice] = useState('mpv');
  const [showPlayerPrompt, setShowPlayerPrompt] = useState(false);

  // Refs to track active instances for cleanup
  const torrentClientRef = useRef(null);
  const serverRef = useRef(null);
  const playerProcRef = useRef(null);
  const selectedPlayer = 'mpv';

  const { exit } = useApp();

  useEffect(() => {
    return () => {
      // Kill player
      if (playerProcRef.current) {
        try {
          playerProcRef.current.kill();
        } catch (err) { }
      }

      // Close server
      if (serverRef.current) {
        serverRef.current.close();
      }

      // Destroy torrent client
      if (torrentClientRef.current) {
        if (torrentClientRef.current.torrent && torrentClientRef.current.downloadHandler) {
          torrentClientRef.current.torrent.off('download', torrentClientRef.current.downloadHandler);
        }
        torrentClientRef.current.destroy();
      }
    };
  }, []);

  const returnToMenu = () => {
    // Kill player if running
    if (playerProcRef.current) {
      // Remove listeners to prevent recursive returnToMenu calls via 'close' event
      playerProcRef.current.removeAllListeners('close');
      playerProcRef.current.removeAllListeners('error');
      try {
        playerProcRef.current.kill();
      } catch (err) {
        // Process might already be dead
      }
      playerProcRef.current = null;
    }

    // Clean up server
    if (serverRef.current) {
      // Destroy all active sockets to ensure immediate cleanup
      if (serverRef.current.sockets) {
        for (const socket of serverRef.current.sockets) {
          socket.destroy();
        }
      }
      serverRef.current.close();
      serverRef.current = null;
    }

    // Clean up torrent with event listener removal
    if (torrentClientRef.current) {
      // Remove download listener if it exists
      if (torrentClientRef.current.torrent && torrentClientRef.current.downloadHandler) {
        torrentClientRef.current.torrent.off('download', torrentClientRef.current.downloadHandler);
      }
      torrentClientRef.current.destroy();
      torrentClientRef.current = null;
    }

    // Reset all state
    setCurMenu('main');
    setSelectedIndex(0);
    setMagnetLink('');
    setStatusMessage('');
    setIsLoading(false);
    setDownloadProgress(0);
    setDownloadSpeed(0);
    setDownloaded(0);
    setTotalSize(0);
    setFileName('');
    setFileSize('');
    setPlayerChoice('mpv');
    setShowPlayerPrompt(false);
  };

  useInput((input, key) => {
    if (input === 'q' && curMenu === 'main') {
      exit();
    }

    switch (curMenu) {
      case 'main':
        if (key.upArrow || input === 'k') {
          setSelectedIndex((prev) => (prev - 1 + menuItems.length) % menuItems.length);
        }
        if (key.downArrow || input === 'j') {
          setSelectedIndex((prev) => (prev + 1) % menuItems.length);
        }
        if (key.return) {
          const chosen = menuItems[selectedIndex];
          setCurMenu(chosen.toLowerCase()); // 'browse' or 'watch'
        }
        if (key.escape) {
          exit();
        }
        break;
    }

    // Global Escape handler to return to main menu from any sub-screen
    if (key.escape) {
      if (curMenu !== 'main') {
        returnToMenu();
      } else {
        exit();
      }
    }
  })

  const handleMagnetSubmit = (value, player) => {
    if (value.trim()) {
      setIsLoading(true);
      setStatusMessage('Processing magnet link...');

      try {
        setStatusMessage('✓ Magnet link received.  Fetching metadata...');

        // Clean up previous sessions
        if (torrentClientRef.current) torrentClientRef.current.destroy();
        if (serverRef.current) {
          if (serverRef.current.sockets) {
            for (const socket of serverRef.current.sockets) {
              socket.destroy();
            }
          }
          serverRef.current.close();
        }

        torrentClientRef.current = new WebTorrent();

        torrentClientRef.current.add(value, { path: 'temp', store: LRUCacheStore }, torrent => {
          // Check if client was destroyed while fetching metadata
          if (!torrentClientRef.current || torrentClientRef.current.destroyed) {
            torrent.destroy();
            return;
          }

          const file = torrent.files.find(f =>
            f.name.endsWith('.mp4') ||
            f.name.endsWith('.avi') ||
            f.name.endsWith('.mkv')
          );

          if (!file) {
            setStatusMessage('✗ No video file found in torrent.');
            client.destroy();
            setIsLoading(false);
            return;
          }

          setStatusMessage('✓ Connected to swarm. Starting server...');
          setFileName(file.name);
          setFileSize((file.length / (1024 * 1024)).toFixed(2) + ' MB');
          setTotalSize(torrent.length / (1024 * 1024));

          const downloadHandler = (bytes) => {
            const progress = torrent.progress * 100;
            if (progress - lastProgress >= 0.1) {
              lastProgress = progress;
              setDownloadProgress(progress);
              setDownloadSpeed(torrent.downloadSpeed / (1024 * 1024));
              setDownloaded(torrent.downloaded / (1024 * 1024));
            }
          }

          let lastProgress = 0;
          torrent.on('download', downloadHandler);

          torrentClientRef.current.downloadHandler = downloadHandler;
          torrentClientRef.current.torrent = torrent;

          const server = http.createServer((req, res) => {
            const range = req.headers.range;

            if (!range) {
              res.setHeader('Content-Length', file.length);
              res.setHeader('Content-Type', 'video/mp4');
              const stream = file.createReadStream();
              stream.pipe(res);

              stream.on('error', (err) => {
                stream.destroy();
              });

              res.on('close', () => {
                stream.destroy();
              });

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
            stream.on('error', (err) => {
              stream.destroy();
            });

            res.on('close', () => {
              stream.destroy();
            });
          });

          // Track sockets to ensure they are closed when server is closed
          const sockets = new Set();
          server.on('connection', (socket) => {
            sockets.add(socket);
            socket.on('close', () => {
              sockets.delete(socket);
            });
          });
          server.sockets = sockets;

          serverRef.current = server;

          server.listen(0, () => {
            const port = server.address().port;
            const url = `http://localhost:${port}/`;

            setStatusMessage(`✓ Server running.  Launching ${player}...`);
            setIsLoading(false);

            playerProcRef.current = spawn(player, [url], {
              stdio: 'ignore',
              detached: false
            });

            playerProcRef.current.on('error', (err) => {
              setStatusMessage(`✗ Failed to spawn player: ${err.message}`);
            });

            playerProcRef.current.on('close', (code) => {
              playerProcRef.current = null;
              returnToMenu();
            });
          });
        });

      } catch (err) {
        setStatusMessage('✗ Error: ' + err.message);
        setIsLoading(false);
      }
    } else {
      setStatusMessage('✗ No magnet link provided');
    }
  };

  const MainMenu = () => (
    <Box flexDirection='column'>
      <Text color='blue' bold>{headerAscii}</Text>
      <Text />
      <Box marginY={2} flexDirection='column'>
        {menuItems.map((item, index) => (
          <Text key={item}>
            {index === selectedIndex ? '> ' : '  '}
            <Text
              color={index === selectedIndex ? '#db68ad' : (item === 'Browse' ? 'green' : 'blue')}
              bold={index === selectedIndex}
              underline={index === selectedIndex}
            >
              {item}
            </Text>
          </Text>
        ))}
      </Box>
      <Text />
      <Text color='gray' dimColor>Use ↑/↓ or j/k to navigate, Enter to select, q to quit</Text>
    </Box>
  );

  const ProgressBar = ({ progress, speed, downloaded, total }) => {
    const barLength = 30;
    const filled = Math.floor((progress / 100) * barLength);
    const empty = barLength - filled;

    return (
      <Box flexDirection='column'>
        <Box>
          <Text color='#00FFFF'>Progress: </Text>
          <Text color='#00FF00'>{'█'.repeat(filled)}</Text>
          <Text color='gray' dimColor>{'░'.repeat(empty)}</Text>
          <Text> </Text>
          <Text bold>{progress.toFixed(1)}%</Text>
          <Text dimColor> ({downloaded.toFixed(2)}/{total.toFixed(2)} MB)</Text>
          <Text>{'   '}</Text>
          <Text color='#FFD700'>↓ {speed.toFixed(2)} MB/s</Text>
        </Box>
      </Box>
    );
  };

  const BrowseScreen = () => (
    <Box flexDirection='column'>
      <Text color='#84f05dff'>{browseAscii}</Text>
      <Text></Text>

      <Text color='yellow' bold>Browse</Text>
      <Text />
      <Text dimColor>Press Esc to go back to the main menu.</Text>
    </Box>
  );

  

const WatchScreen = () => {
  // Intercept huge paste chunks
  useEffect(() => {
    const onData = (chunk) => {
      const text = chunk.toString();

      // Detect large paste (more than 40 chars in one chunk)
      if (text.length > 40) {
        setMagnetLink((prev) => prev + text.trim());
        return;
      }
    };

    process.stdin.on("data", onData);
    return () => process.stdin.off("data", onData);
  }, []);

  // Make a short preview: "ABC...XYZ (length chars)"
  const preview = magnetLink.length
    ? `${magnetLink.slice(0, 20)}...${magnetLink.slice(-10)} (${magnetLink.length} chars)`
    : "";

  return (
    <Box flexDirection="column">
      <Text color="cyan">{watchAscii}</Text>
      <Text />

      {!showPlayerPrompt ? (
        <Box flexDirection="column" marginY={1}>
          <Box>
            <Text color="cyan">┌─[</Text>
            <Text color="#00CCCC"> Magnet Link </Text>
            <Text color="cyan">]</Text>
          </Box>

          {/* TextInput is empty, but still used for typing */}
          <Box>
            <Text color="cyan">{'└─> '}</Text>
            <TextInput
              value=""
              onChange={(v) => {
                if (v.length === 1) {
                  setMagnetLink((prev) => prev + v);
                }
              }}
              onSubmit={() => {
                if (magnetLink.trim()) setShowPlayerPrompt(true);
              }}
              placeholder="Paste magnet link or type..."
              focus={true}
            />
          </Box>

          {/* Truncated preview */}
          {magnetLink.length > 0 && (
            <Box marginTop={1} marginLeft={2}>
              <Text dimColor>Magnet: {preview}</Text>
            </Box>
          )}
        </Box>
      ) : (
        <Box flexDirection="column" marginY={1}>
          <Box>
            <Text color="#bc5ef6ff">┌─[</Text>
            <Text color="#f97fc6ff"> Select Player </Text>
            <Text color="#bc5ef6ff">]</Text>
          </Box>
          <Box>
            <Text color="#bc5ef6ff">{'└─> '}</Text>
            <TextInput
              value={playerChoice}
              onChange={setPlayerChoice}
              onSubmit={(value) => {
                setShowPlayerPrompt(false);
                handleMagnetSubmit(magnetLink, value.trim() || "mpv");
              }}
              placeholder="mpv or vlc [default: mpv]"
              focus={true}
            />
          </Box>
        </Box>
      )}

      {/* Your existing download + status UI */}
      {statusMessage && (
        <Box marginY={1} marginLeft={2}>
          <Text
            color={
              statusMessage.startsWith("✓")
                ? "#84f05dff"
                : statusMessage.startsWith("✗")
                ? "red"
                : "yellow"
            }
          >
            {statusMessage}
          </Text>
        </Box>
      )}

      {fileName && (
        <Box
          marginLeft={2}
          flexDirection="column"
          borderColor="cyan"
          borderStyle="round"
          width="fit"
        >
          <Box>
            <Text color="white" bold>{"File: "}</Text>
            <Text color="white">{fileName}</Text>
          </Box>
          <Box>
            <Text color="white" bold>{"Size: "}</Text>
            <Text color="white">{fileSize}</Text>
          </Box>
          <Box>
            <Text color="white" bold>{"Player: "}</Text>
            <Text color="white">{playerChoice.toUpperCase()}</Text>
          </Box>
        </Box>
      )}

      {isLoading && (
        <Box marginLeft={2}>
          <Text color="#e776b9ff">
            <Spinner /> <Text>Loading...</Text>
          </Text>
        </Box>
      )}

      {downloadProgress > 0 && (
        <Box marginLeft={2} marginTop={1}>
          <ProgressBar
            progress={downloadProgress}
            speed={downloadSpeed}
            downloaded={downloaded}
            total={totalSize}
          />
        </Box>
      )}

      <Text />
      <Text dimColor>Paste magnet link. Press Esc to go back.</Text>
    </Box>
  );
};


  // const WatchScreen = () => (
  //   <Box flexDirection='column'>
  //     <Text color='cyan'>{watchAscii}</Text>
  //     <Text />

  //     {!showPlayerPrompt ? (
  //       <Box flexDirection='column' marginY={1}>
  //         <Box>
  //           <Text color='cyan'>┌─[</Text>
  //           <Text color='#00CCCC'> Magnet Link </Text>
  //           <Text color='cyan'>]</Text>
  //         </Box>
  //         <Box>
  //           <Text color='cyan'>└─&gt; </Text>
  //           <TextInput
  //             value={magnetLink}
  //             onChange={setMagnetLink}
  //             onSubmit={(value) => {
  //               if (value.trim()) {
  //                 setShowPlayerPrompt(true);
  //               }
  //             }}
  //             placeholder="Enter magnet link here..."
  //             focus={true}
  //           />
  //         </Box>
  //       </Box>
  //     ) : (
  //       <Box flexDirection='column' marginY={1}>
  //         <Box>
  //           <Text color='#bc5ef6ff'>┌─[</Text>
  //           <Text color='#f97fc6ff'> Select Player </Text>
  //           <Text color='#bc5ef6ff'>]</Text>
  //         </Box>
  //         <Box>
  //           <Text color='#bc5ef6ff'>└─&gt; </Text>
  //           <TextInput
  //             value={playerChoice}
  //             onChange={setPlayerChoice}
  //             onSubmit={(value) => {
  //               setShowPlayerPrompt(false);
  //               handleMagnetSubmit(magnetLink, value.trim() || 'mpv');
  //             }}
  //             placeholder="mpv or vlc [default: mpv]"
  //             focus={true}
  //           />
  //         </Box>
  //       </Box>
  //     )}

  //     {statusMessage && (
  //       <Box marginY={1} marginLeft={2}>
  //         <Text color={statusMessage.startsWith('✓') ? '#84f05dff' : statusMessage.startsWith('✗') ? 'red' : 'yellow'}>
  //           {statusMessage}
  //         </Text>
  //       </Box>
  //     )}

  //     {fileName && (
  //       <Box marginLeft={2} flexDirection='column' borderColor='cyan' borderStyle='round' width='fit'>
  //         <Box>
  //           <Text color='white' bold>{'File: '}</Text><Text color='white'>{fileName}</Text>
  //         </Box>
  //         <Box>
  //           <Text color='white' bold>{'Size: '}</Text><Text color='white'>{fileSize}</Text>
  //         </Box>
  //         <Box>
  //           <Text color='white' bold>{'Player: '}</Text><Text color='white'>{playerChoice.toUpperCase()}</Text>
  //         </Box>
  //       </Box>
  //     )}

  //     {isLoading && (
  //       <Box marginLeft={2}>
  //         <Text color='#e776b9ff'>
  //           <Spinner /> <Text>Loading...</Text>
  //         </Text>
  //       </Box>
  //     )}

  //     {downloadProgress > 0 && (
  //       <Box marginLeft={2} marginTop={1}>
  //         <ProgressBar
  //           progress={downloadProgress}
  //           speed={downloadSpeed}
  //           downloaded={downloaded}
  //           total={totalSize}
  //         />
  //       </Box>
  //     )}

  //     <Text />
  //     <Text color='gray' dimColor>Enter magnet link and press Enter.  Press Esc to go back.</Text>
  //   </Box>
  // );

  return (
    <>
      {curMenu === 'main' && <MainMenu />}
      {curMenu === 'browse' && <BrowseScreen />}
      {curMenu === 'watch' && <WatchScreen />}
    </>
  );
}