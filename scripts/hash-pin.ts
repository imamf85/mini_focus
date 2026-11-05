import bcrypt from "bcryptjs";

const pin = process.argv[2];
if (!pin) {
  console.error("Pemakaian: npm run hash-pin -- 1234");
  process.exit(1);
}
if (!/^\d{4,12}$/.test(pin)) console.error("Peringatan: PIN sebaiknya 4-12 digit angka.");
console.log(bcrypt.hashSync(pin, 10));
