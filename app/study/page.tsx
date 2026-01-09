import dynamic from "next/dynamic";

const StudyClient = dynamic(() => import("./StudyClient"), {
  ssr: false,
});

export default function Page() {
  return <StudyClient />;
}
