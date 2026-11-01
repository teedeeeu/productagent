/**
 * Test datasets in the "simple" CSV format. `npm run samples` writes these
 * to CSV files; tests read the CSV files so the full CSV → scan path is tested.
 *
 * FITNESSKING: reconstructed from the regression cases in the product brief
 * (the conflicting values are as described there). Surrounding copy is
 * representative, not scraped from fitnessking.nl. Replace with a real export
 * when available.
 *
 * EXAMPLE: fictional products ("Demo Fitness") that show the CSV format and
 * cover clean products (false-positive checks) and each issue type.
 */

export interface SimpleRow {
  product_id: string;
  title: string;
  description: string;
  vendor: string;
  product_type: string;
  product_url: string;
  variants: string;
  metafields: string;
  specifications: string;
  manufacturer_url: string;
  manufacturer_specifications: string;
}

const row = (r: Partial<SimpleRow> & Pick<SimpleRow, "product_id" | "title">): SimpleRow => ({
  description: "",
  vendor: "",
  product_type: "",
  product_url: "",
  variants: "",
  metafields: "",
  specifications: "",
  manufacturer_url: "",
  manufacturer_specifications: "",
  ...r,
});

export const FITNESSKING: SimpleRow[] = [
  row({
    product_id: "fk-dc-athletics-pacer",
    title: "DC Athletics Pacer loopband",
    vendor: "DC Athletics",
    product_type: "Loopband",
    product_url: "https://www.fitnessking.nl/products/dc-athletics-pacer",
    description:
      "<p>De DC Athletics Pacer is een compacte loopband voor thuisgebruik. De motor levert 2 PK continu vermogen, waardoor je soepel kunt wandelen en hardlopen tot 14 km/u.</p><p>Dankzij het opklapbare frame berg je de loopband eenvoudig op.</p>",
    specifications:
      "Continu vermogen: 1 PK | Piekvermogen: 2 PK | Maximale snelheid: 14 km/u | Max. gebruikersgewicht: 120 kg | Loopvlak: 130 x 45 cm | Afmetingen (L x B x H): 165 x 70 x 125 cm",
  }),
  row({
    product_id: "fk-christopeit-tm4500s",
    title: "Christopeit TM4500s loopband",
    vendor: "Christopeit",
    product_type: "Loopband",
    product_url: "https://www.fitnessking.nl/products/christopeit-tm4500s",
    description:
      "<p>De Christopeit TM4500s is een stevige loopband voor intensieve trainingen. Hij is compatibel met Zwift via Bluetooth, zodat je virtueel kunt hardlopen. De motor heeft een continu vermogen van 2,5 PK.</p><ul><li>Snelheid tot 18 km/u</li><li>Elektrische hellingsverstelling</li></ul>",
    specifications:
      "Motorvermogen continu: 2 PK | Motorvermogen piek: 3,5 PK | Zwift compatibel: Nee | Kinomap compatibel: Ja | Max. snelheid: 18 km/u | Max. gebruikersgewicht: 140 kg | Hellingshoek: 0 - 15% | Loopvlak: 140 x 50 cm | Afmetingen: 185 x 80 x 140 cm",
  }),
  row({
    product_id: "fk-bh-i-hudson-r325",
    title: "BH Fitness i.Hudson R325",
    vendor: "BH Fitness",
    product_url: "https://www.fitnessking.nl/products/bh-fitness-i-hudson-r325",
    description:
      "<p>De BH Fitness i.Hudson R325 combineert een degelijke constructie met moderne connectiviteit. Geschikt voor gebruikers tot 125 kg.</p>",
    specifications: "Max. gebruikersgewicht: 180 kg | Afmetingen: 160 x 60 x 130 cm",
    manufacturer_url: "https://www.bhfitness.com/",
    manufacturer_specifications: "Max. gebruikersgewicht: 125 kg",
  }),
  row({
    product_id: "fk-christopeit-tm750s",
    title: "Christopeit TM750s loopband",
    vendor: "Christopeit",
    product_type: "Loopband",
    product_url: "https://www.fitnessking.nl/products/christopeit-tm750s",
    description:
      "<p>De Christopeit TM750s is een instapmodel voor wandelen en licht hardlopen.</p>",
    specifications:
      "Verstelbare helling: Niet beschikbaar | Snelkeuzetoetsen helling: Ja | Snelkeuzetoetsen snelheid: Ja | Max. snelheid: 16 km/u | Max. gebruikersgewicht: 120 kg | Motorvermogen continu: 1,5 PK | Loopvlak: 125 x 42 cm | Afmetingen: 160 x 70 x 125 cm",
  }),
];

export const EXAMPLE: SimpleRow[] = [
  // Clean: consistent values written in different units. Must produce NO findings.
  row({
    product_id: "demo-runner-500",
    title: "Demo Fitness Runner 500 treadmill",
    vendor: "Demo Fitness",
    product_type: "Treadmill",
    product_url: "https://example.com/products/runner-500",
    description:
      "<p>The Runner 500 supports users weighing up to 300 lbs and reaches speeds of up to 10 mph. Its 2 HP continuous motor (3.5 HP peak) stays quiet at any pace. Compatible with Zwift and Kinomap.</p>",
    specifications:
      "Max user weight: 136 kg | Max speed: 16 km/h | Continuous motor power: 2 PK | Peak motor power: 3,5 PK | Zwift: Yes | Kinomap: Yes | Running surface: 140 x 50 cm | Dimensions (L x W x H): 180 x 80 x 135 cm",
    variants: "Black | Silver",
  }),
  // Clean rower: max speed and motor power must NOT be required for rowing machines.
  row({
    product_id: "demo-row-air",
    title: "Demo Fitness AirRow rowing machine",
    vendor: "Demo Fitness",
    product_type: "Rowing machine",
    description: "<p>Air resistance that grows with every stroke. Folds upright for storage.</p>",
    specifications: "Resistance type: Air | Max user weight: 150 kg | Dimensions: 240 x 55 x 95 cm",
  }),
  // Missing max user weight (walking pad) — high severity.
  row({
    product_id: "demo-walkpad-1",
    title: "Demo Fitness DeskWalk walking pad",
    vendor: "Demo Fitness",
    product_type: "Walking pad",
    description: "<p>A slim walking pad for under your desk. Walk at up to 6 km/h while you work.</p>",
    specifications: "Max speed: 6 km/h | Dimensions: 140 x 55 x 15 cm",
  }),
  // Ambiguous power, vague tall-user claim, vague app claim, older model reference.
  row({
    product_id: "demo-rx200",
    title: "Demo Fitness RX200 treadmill",
    vendor: "Demo Fitness",
    product_type: "Treadmill",
    description:
      "<p>The RX200 has a powerful 3 HP motor and is suitable for tall users. It works with popular fitness apps. Like the RX100, it folds flat for storage.</p>",
    specifications: "Max user weight: 130 kg | Max speed: 16 km/h | Running surface: 135 x 46 cm | Dimensions: 175 x 75 x 130 cm",
  }),
  // Variant contradicts the main product data.
  row({
    product_id: "demo-walkpad-2",
    title: "Demo Fitness FlatWalk walking pad",
    vendor: "Demo Fitness",
    product_type: "Walking pad",
    description: "<p>Suitable for users up to 120 kg. Top speed 8 km/h.</p>",
    specifications: "Max user weight: 120 kg | Max speed: 8 km/h | Dimensions: 145 x 60 x 14 cm",
    variants: "Black / Max load 100 kg | White / Max load 100 kg",
  }),
  // Unknown category: no category-specific missing-attribute checks.
  row({
    product_id: "demo-yoga-mat",
    title: "Demo Fitness Yoga Mat",
    vendor: "Demo Fitness",
    product_type: "Accessories",
    description: "<p>Non-slip yoga mat, 6 mm thick.</p>",
  }),
];
