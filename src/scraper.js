import * as cheerio from 'cheerio';
import fs from 'fs';

const url = 'https://animetosho.org/';

const parseHtml = (html) => {
    const $ = cheerio.load(html);

    const results = [];

    $('.home_list_entry.home_list_entry_alt, .home_list_entry, .home_list_entry_compl_1').each((index, element) => {
        const titleElement = $(element).find('.link a');
        const title = titleElement.text().trim();

        const links = [];

        $(element).find('.links a.dlink, .links a[href^="magnet:"]').each((linkIndex, linkElement) => {
            const href = $(linkElement).attr('href');
            const text = $(linkElement).text().trim();

            links.push({
                href: href,
                text: text,
                isMagnet: href && href.startsWith('magnet:')
            });
        });

        if (title && links.length > 0) {
            results.push({
                title: title,
                links: links,
            });
        }
    });
    
    const output = {
        meta: {
            parseEntries: results.length,
            date: new Date().toISOString(),
        },
        entries: results,
    };

    return output;
}

const getRecentAdded = async () => {
    const response = await fetch(url);
    if (!response.ok) {
        console.debug('Failed to scrape');
    }

    const html = await response.text();
    
    const results = parseHtml(html);

    fs.writeFile('test.json', JSON.stringify(results, null, 2), (err) => { });
    
}

const getQuery = async () => {
    const response = await fetch(url);
}

getRecentAdded();