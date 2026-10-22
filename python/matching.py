"""Content-based game matching. JSON in on stdin, JSON out on stdout.

No database or network access. Node supplies only catalogue and taste inputs.
TF-IDF keywords and weighted genre/tag/platform vectors are compared with cosine
similarity. The displayed percentage is a match score, not a probability.
"""
import json
import math
import re
import sys
from collections import Counter

STOPWORDS = set('a about across after against all along also an and any are around as at be because been before being between both but by can could do does each even every for from further has have he her his how if in into is it its just like made make many more most much new not now of on once one only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was way we were what when where which while who why will with within without would you your become becomes build builds choose choosing designed different explore filled latest player players story world enter take continue switch play lead work follow gather defend rescue climb inherit track reconnect swing investigate together using three part close draws approaches matter pulling plans'.split())
STATUS = {'completed': 1, 'playing': .8, 'played': .7, 'want_to_play': .35}


def normalize(vector):
    length = math.sqrt(sum(v*v for v in vector.values()))
    return {k: v/length for k, v in vector.items()} if length else vector


def dot(a, b):
    return sum(value*b.get(key, 0) for key, value in a.items())


def add(vector, key, value):
    vector[key] = vector.get(key, 0) + value


def words(text):
    return [w for w in re.split('[^a-z0-9-]+', str(text).lower().replace("'", '').replace('’', '')) if len(w) >= 4 and w not in STOPWORDS and not w.isdigit()]


def label(key):
    kind, value = key.split(':', 1)
    if kind == 'platform':
        return {'steam': 'PC', 'playstation': 'PlayStation', 'xbox': 'Xbox'}.get(value, value)
    return value.title().replace('Rpg', 'RPG').replace('Co-Op', 'Co-op').replace('Sci-Fi', 'Sci-fi')


def distinct(labels, limit):
    chosen = []
    for item in labels:
        tokens = set(item.lower().split())
        if any(tokens <= set(old.lower().split()) or set(old.lower().split()) <= tokens for old in chosen):
            continue
        chosen.append(item)
        if len(chosen) >= limit:
            break
    return chosen


def vectors_for(games):
    documents = {g['slug']: words(g.get('description', '')) for g in games}
    frequency = Counter(word for document in documents.values() for word in set(document))
    vectors = {}
    for game in games:
        vector = {}
        genre = str(game.get('genre', '')).lower()
        add(vector, 'genre:'+genre, 2)
        for word in genre.split():
            add(vector, 'tag:'+word, 1.2)
        tags = set()
        for tag in str(game.get('tags') or '').lower().split(','):
            tag = tag.strip()
            tag = {'soulslike': 'soulslike', 'coop': 'co-op', 'citybuilder': 'city builder'}.get(re.sub(r'[\s-]', '', tag), tag)
            if tag:
                tags.add(tag)
        for tag in sorted(tags):
            add(vector, 'tag:'+tag, 1)
        for platform in str(game.get('platforms') or '').split(','):
            if platform.strip():
                add(vector, 'platform:'+platform.strip(), .15)
        year = int(game.get('year') or 0)
        add(vector, 'era:'+('new' if year >= 2023 else 'modern' if year >= 2018 else 'classic'), .3)
        document = documents[game['slug']]
        for word, count in Counter(document).items():
            add(vector, 'kw:'+word, .35 * count/max(len(document), 1) * math.log(1+len(games)/frequency[word]) * 4)
        vectors[game['slug']] = normalize(vector)
    return vectors


def percent(score):
    clamped = max(0, min(1, score))
    return math.floor(100*(1-(1-clamped)**2)+.5)


def known_reason(entry, title):
    rating = entry.get('rating')
    if isinstance(rating, (int, float)) and rating >= 4:
        return f'Because you rated {title} {rating:g}★'
    if entry.get('isFavorite'):
        return f'Because {title} is one of your favorites'
    verb = {'completed': 'completed', 'playing': "are playing", 'played': 'played'}.get(entry.get('status'))
    return f'Because you {verb} {title}' if verb else f'Similar to {title} on your wishlist'


def match(payload):
    games = payload['games']
    by_slug = {g['slug']: g for g in games}
    vectors = vectors_for(games)
    taste = payload.get('taste', {})
    history = taste.get('history', [])
    known = {entry['slug'] for entry in history}
    profile, contributions = {}, []
    for entry in history:
        vector = vectors.get(entry['slug'])
        if vector is None:
            continue
        weight = STATUS.get(entry.get('status'), 0) + (.6 if entry.get('isFavorite') else 0)
        rating = entry.get('rating')
        if isinstance(rating, (int, float)) and math.isfinite(rating):
            weight += ((rating-3)/2)*1.2
        if weight:
            contributions.append((entry, weight))
            for key, value in vector.items():
                add(profile, key, weight*value)
    # Private dismissals hide exact games and gently lower similar features.
    dismissed = set(taste.get('dismissed', []))
    for slug in sorted(dismissed - known):
        for key, value in vectors.get(slug, {}).items():
            add(profile, key, -.35 * value)
    for genre in taste.get('favoriteGenres', []):
        add(profile, 'tag:'+genre.lower(), .8)
    if taste.get('preferredPlatform'):
        add(profile, 'platform:'+taste['preferredPlatform'], .5)
    profile = normalize({key: value for key, value in profile.items() if value > 0})
    dna_items = sorted(((key, value) for key, value in profile.items() if key.startswith(('tag:', 'platform:'))), key=lambda item: -item[1])
    total = sum(value for _, value in dna_items) or 1
    dna = [{'label': label(key), 'share': math.floor(value/total*100+.5)} for key, value in dna_items[:6]]
    scores = []
    for game in games:
        slug = game['slug']
        vector = vectors[slug]
        similarity = dot(profile, vector)
        score = .82*similarity + .18*max(0, min(5, float(game.get('rating') or 0)))/5
        if not profile:
            scores.append({'slug': slug, 'score': None, 'similarity': None, 'match': None, 'reason': 'Popular with Checkpoint players', 'traits': [game.get('genre', '')], 'basedOn': None})
            continue
        shared = sorted(((key, value*profile.get(key, 0)) for key, value in vector.items() if profile.get(key, 0) and not key.startswith('era:')), key=lambda item: -item[1])
        named = [label(key) for key, _ in shared if key.startswith(('genre:', 'tag:'))]
        platforms = [label(key) for key, _ in shared if key.startswith('platform:')]
        traits = distinct(named+platforms, 3 if len(named) >= 2 else 1)
        links = [(dot(vectors[entry['slug']], vector)*weight, dot(vectors[entry['slug']], vector), entry) for entry, weight in contributions if weight > 0 and entry['slug'] != slug]
        closest = max(links, key=lambda item: item[0]) if links else None
        link = closest[2] if closest and closest[1] >= .4 else None
        favorite = next((genre for genre in taste.get('favoriteGenres', []) if 'tag:'+genre.lower() in vector), None)
        if link:
            reason = known_reason(link, by_slug[link['slug']]['title'])
        elif favorite:
            reason = 'Matches your favorite genre: '+favorite
        elif named:
            reason = 'Shares '+' and '.join(distinct(named, 2))+' with games you like'
        elif platforms:
            reason = 'Fits the platforms you play on'
        else:
            reason = 'Highly rated by Checkpoint players'
        scores.append({'slug': slug, 'score': score, 'similarity': similarity, 'match': percent(score), 'reason': reason, 'traits': traits, 'basedOn': link['slug'] if link else None})
    picks = [item for item in scores if item['slug'] not in known and item['slug'] not in dismissed]
    if profile:
        picks.sort(key=lambda item: (-item['score'], item['slug']))
    else:
        picks.sort(key=lambda item: (-float(by_slug[item['slug']].get('rating') or 0), -int(by_slug[item['slug']].get('year') or 0), item['slug']))
    return {'engine': 'python', 'picks': picks, 'scores': scores, 'dna': dna, 'isColdStart': not profile, 'knownCount': len(known)}


if __name__ == '__main__':
    try:
        print(json.dumps(match(json.load(sys.stdin)), ensure_ascii=False, allow_nan=False))
    except (ValueError, KeyError, TypeError) as error:
        print(f'Invalid matching input: {error}', file=sys.stderr)
        sys.exit(1)
