// THE REAL WORDS A GENERATED NAME IS BUILT FROM — a quality and a creature, joined with a constructed tail.
//
// REPORTED: "If the player hasnt provided a name, generate a pseudonym from two or three lists of short words that can be
// joined together to make an interesting construct. The player can use a next button to generate a new one. The name lists
// should be long enough to work with 5 million players."
//
// WHY TWO REAL LISTS AND A THIRD CONSTRUCTED ONE. Three real lists would need roughly a thousand words each for the same
// space, and a thousand distinct short adjectives does not exist without inventing words anyway. So the QUALITY and the
// CREATURE are real ("Jolly", "Badger") and the third element is built from a syllable table in `puzzle/pseudonym.ts`
// ("Brost") — which is what a pseudonym tail is, and what makes `JollyBadgerBrost` read as one name rather than as three
// dictionary words in a row. `pseudonym-probe.mjs` prints the exact number of combinations, after the name-length rule, and
// states it against five million players.
//
// THE RULES EVERY ENTRY OBEYS, each asserted by `game/test/pseudonym-probe.mjs` rather than trusted here:
//   * lowercase letters only, so a join needs no sanitiser between the parts;
//   * 3 to 8 characters, so two words plus a tail can fit `ALIAS_MAX` (16) and still leave the tail room;
//   * NO DUPLICATES, which would silently shrink the space the design rests on.
export const QUALITIES: readonly string[] = [
  'able', 'agile', 'amber', 'ample', 'angry', 'arctic', 'artful', 'astral', 'atomic', 'awake',
  'aware', 'azure', 'balmy', 'bashful', 'beady', 'beefy', 'beige', 'benign', 'bleak', 'blithe',
  'blond', 'blue', 'bluff', 'blunt', 'bold', 'bonny', 'bossy', 'bouncy', 'brawny', 'brave',
  'breezy', 'brief', 'bright', 'brisk', 'broad', 'bronze', 'brown', 'bubbly', 'bulky', 'bumpy',
  'burly', 'bushy', 'busy', 'calm', 'candid', 'canny', 'casual', 'catchy', 'chalky', 'charmed',
  'chatty', 'cheeky', 'cheery', 'cherry', 'chic', 'chief', 'chilly', 'chirpy', 'chubby', 'chunky',
  'civil', 'clammy', 'classic', 'classy', 'clean', 'clear', 'clever', 'cloudy', 'clumsy', 'coarse',
  'cocky', 'cold', 'comely', 'comic', 'cool', 'copper', 'coral', 'cosy', 'cozy', 'crafty',
  'craggy', 'cranky', 'creamy', 'crimson', 'crisp', 'cross', 'curly', 'cushy', 'dainty', 'damp',
  'dandy', 'dapper', 'daring', 'dark', 'dazzling', 'dear', 'decent', 'deft', 'delicate', 'dense',
  'dewy', 'dim', 'dingy', 'direct', 'dizzy', 'docile', 'doughty', 'downy', 'drafty', 'dreamy',
  'droll', 'droopy', 'drowsy', 'dry', 'dusky', 'dusty', 'eager', 'early', 'earthy', 'easy',
  'elated', 'elegant', 'elite', 'empty', 'epic', 'even', 'exact', 'fabled', 'faded', 'faint',
  'fair', 'famous', 'fancy', 'fast', 'fearless', 'feisty', 'feral', 'ferny', 'fickle', 'fierce',
  'fiery', 'filmy', 'final', 'fine', 'firm', 'fiscal', 'fit', 'fizzy', 'flaky', 'flat',
  'flawless', 'fleet', 'flimsy', 'flinty', 'floaty', 'fluffy', 'fluid', 'foamy', 'foggy', 'fond',
  'frank', 'free', 'fresh', 'frosty', 'frugal', 'fruity', 'fuzzy', 'gamy', 'gentle', 'giant',
  'giddy', 'gifted', 'glad', 'glassy', 'gloomy', 'glossy', 'glowing', 'golden', 'good', 'grand',
  'grateful', 'grave', 'gray', 'great', 'greedy', 'green', 'grey', 'grim', 'gritty', 'groovy',
  'gruff', 'grumpy', 'gusty', 'gutsy', 'hairy', 'hale', 'handy', 'happy', 'hardy', 'harsh',
  'hasty', 'hazel', 'hazy', 'hearty', 'hefty', 'heroic', 'hidden', 'high', 'hollow', 'honest',
  'humble', 'humid', 'hungry', 'husky', 'hushed', 'iced', 'icy', 'ideal', 'idle', 'inky',
  'inner', 'iron', 'ivory', 'jaded', 'jagged', 'jaunty', 'jazzy', 'jolly', 'jovial', 'juicy',
  'jumpy', 'keen', 'kind', 'kindly', 'lacy', 'large', 'late', 'lazy', 'leafy', 'lean',
  'level', 'light', 'lilac', 'limber', 'limp', 'linen', 'little', 'lively', 'livid', 'loamy',
  'lofty', 'lone', 'lonely', 'long', 'loose', 'loud', 'loved', 'lovely', 'loyal', 'lucid',
  'lucky', 'lunar', 'lush', 'magic', 'maize', 'major', 'mellow', 'merry', 'mighty', 'mild',
  'milky', 'misty', 'mixed', 'modern', 'modest', 'moody', 'mossy', 'muddy', 'mushy', 'musky',
  'musty', 'muted', 'narrow', 'nasty', 'native', 'natty', 'navy', 'near', 'neat', 'needy',
  'newer', 'nice', 'nimble', 'noble', 'noisy', 'novel', 'nutty', 'oaken', 'odd', 'olive',
  'open', 'orange', 'ornate', 'outer', 'oval', 'owned', 'pale', 'pastel', 'peach', 'pearly',
  'peppy', 'perky', 'petite', 'pink', 'plain', 'plucky', 'plump', 'plush', 'polar', 'polite',
  'pretty', 'prime', 'prize', 'proud', 'prudent', 'puffy', 'pure', 'purple', 'quaint', 'quick',
  'quiet', 'quirky', 'rank', 'rapid', 'rare', 'rash', 'ready', 'real', 'red', 'regal',
  'rich', 'right', 'ripe', 'risky', 'rosy', 'rough', 'round', 'royal', 'ruby', 'ruddy',
  'rude', 'rugged', 'rustic', 'rusty', 'safe', 'sage', 'sandy', 'sane', 'sassy', 'scarce',
  'scarlet', 'scenic', 'serene', 'severe', 'shady', 'shallow', 'shapely', 'sharp', 'sheer', 'shiny',
  'short', 'shrill', 'shy', 'silent', 'silken', 'silky', 'silly', 'silver', 'simple', 'sincere',
  'sleek', 'slender', 'slick', 'slight', 'slim', 'slimy', 'slow', 'small', 'smart', 'smoky',
  'smooth', 'snappy', 'sneaky', 'snug', 'sober', 'soft', 'solar', 'solid', 'sonic', 'sooty',
  'sound', 'sour', 'spare', 'sparse', 'spicy', 'spiky', 'spiral', 'splendid', 'spotty', 'spry',
  'square', 'stable', 'staid', 'stark', 'stately', 'steady', 'steel', 'steep', 'stern', 'stiff',
  'still', 'stout', 'straight', 'strict', 'strong', 'sturdy', 'suave', 'subtle', 'sudden', 'sunny',
  'super', 'superb', 'supple', 'sure', 'swanky', 'swarthy', 'sweet', 'swift', 'tacit', 'tall',
  'tame', 'tangible', 'tart', 'tasty', 'taut', 'teal', 'tender', 'tense', 'tepid', 'terse',
  'thick', 'thin', 'tidy', 'tight', 'timely', 'timid', 'tiny', 'tired', 'topaz', 'total',
  'tough', 'trim', 'true', 'twin', 'ultra', 'umber', 'united', 'upper', 'urban', 'usable',
  'usual', 'vague', 'valid', 'vast', 'veined', 'velvet', 'verdant', 'vibrant', 'violet', 'vivid',
  'vocal', 'wakeful', 'warm', 'wary', 'watery', 'wavy', 'waxen', 'waxy', 'weak', 'weary',
  'weekly', 'weird', 'wet', 'white', 'whole', 'wide', 'wild', 'wily', 'windy', 'winged',
  'wise', 'wispy', 'witty', 'woody', 'woolly', 'worldly', 'worthy', 'wry', 'yellow', 'young',
  'zany', 'zesty', 'zigzag', 'zippy', 'zonal',
];

export const CREATURES: readonly string[] = [
  'ant', 'ape', 'asp', 'auk', 'badger', 'bat', 'bear', 'beaver', 'bee', 'beetle',
  'bison', 'boar', 'bobcat', 'bug', 'bull', 'bunny', 'camel', 'carp', 'cat', 'cattle',
  'chick', 'chimp', 'clam', 'cobra', 'cod', 'condor', 'coot', 'cougar', 'cow', 'coyote',
  'crab', 'crane', 'cricket', 'crow', 'cub', 'curlew', 'deer', 'dingo', 'dog', 'dolphin',
  'donkey', 'dove', 'dragon', 'duck', 'eagle', 'eel', 'egret', 'elk', 'emu', 'falcon',
  'fawn', 'ferret', 'finch', 'fish', 'flea', 'fly', 'fox', 'frog', 'gander', 'gar',
  'gecko', 'gnat', 'goat', 'goose', 'gopher', 'gorilla', 'grouse', 'guppy', 'haddock', 'hare',
  'hawk', 'hen', 'heron', 'herring', 'hippo', 'hog', 'hound', 'hyena', 'ibex', 'ibis',
  'impala', 'jackal', 'jaguar', 'jay', 'kangaroo', 'kestrel', 'kid', 'kite', 'kitten', 'kiwi',
  'koala', 'lamb', 'lark', 'lemming', 'lemur', 'leopard', 'lion', 'lizard', 'llama', 'lobster',
  'loon', 'lynx', 'magpie', 'mallard', 'mammoth', 'mare', 'marmot', 'marten', 'mink', 'minnow',
  'mole', 'mongoose', 'monkey', 'moose', 'moth', 'mouse', 'mule', 'mussel', 'newt', 'nightjar',
  'ocelot', 'octopus', 'okapi', 'opossum', 'orca', 'oriole', 'osprey', 'ostrich', 'otter', 'owl',
  'oxen', 'oyster', 'panda', 'panther', 'parrot', 'peacock', 'pelican', 'penguin', 'perch', 'pheasant',
  'pig', 'pigeon', 'pike', 'piranha', 'plover', 'pony', 'poodle', 'porpoise', 'possum', 'puma',
  'pup', 'puppy', 'quail', 'quokka', 'rabbit', 'raccoon', 'ram', 'rat', 'raven', 'reindeer',
  'robin', 'rooster', 'salmon', 'sardine', 'seal', 'shark', 'sheep', 'shrew', 'shrimp', 'shrike',
  'skink', 'skunk', 'sloth', 'slug', 'snail', 'snake', 'sole', 'sparrow', 'spider', 'sponge',
  'squid', 'squirrel', 'stag', 'starfish', 'stoat', 'stork', 'swan', 'swift', 'tapir', 'tern',
  'thrush', 'tiger', 'toad', 'tortoise', 'toucan', 'trout', 'tuna', 'turkey', 'turtle', 'viper',
  'vole', 'vulture', 'wallaby', 'walrus', 'warbler', 'wasp', 'weasel', 'whale', 'whippet', 'wolf',
  'wombat', 'worm', 'wren', 'yak', 'zebra', 'zebu', 'koi', 'numbat', 'quoll', 'serval',
];
