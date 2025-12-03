#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import App from './app.js';

const cli = meow(
	`
		Usage
		  $ ba-ani-sh

		Options
			--play, -p		Magnet link to play directly
			--player		Player to use (mpv, vlc) [Default: mpv]
			Note: Player command should be in PATH
		
		Examples
		  $ ba-ani-sh --play "magnet:?xt=urn:btih:..." --player vlc
	`,
	{
		importMeta: import.meta,
		flags: {
			play: {
				type: 'string',
				shortFlag: 'p',
			},
			player: {
				type: 'string',
				default: 'mpv',
			}
		}
	},
);

render(<App play={cli.flags.play} player={cli.flags.player} />);
